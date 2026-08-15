import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join, parse as parsePath } from 'node:path';
import { dialog, ipcMain, type BrowserWindow } from 'electron';
import type { ClientChannel } from 'ssh2';

import { ConnectionManager, type SshConnection } from './ssh/connection-manager';
import { RemoteMonitor } from './ssh/monitor';
import { listServices, runServiceAction } from './ssh/services';
import { getGitStatus, runGitAction } from './ssh/git';
import { runDeploy, type DeployRunHandle } from './ssh/deploy';
import { trustHostKey } from './ssh/known-hosts';
import { parseSshConfig } from './ssh/ssh-config';
import { RemoteEditManager } from './ssh/remote-edit';
import { SessionStore } from './store/sessions';
import { LocalTerminalManager } from './local-terminal';
import { AppLock } from './app-lock';
import { preferences, sftpPreferences } from './store/preferences';
import { projects } from './store/projects';
import type {
  GitAction,
  RemoteFile,
  ServiceAction,
  SessionConfig,
  Secret,
} from '../src/shared/types';

/** "foto.jpg" -> "foto (1).jpg" -> "foto (2).jpg" ... sampai ketemu yang belum dipakai. */
function uniqueLocalPath(target: string): string {
  const { dir, name, ext } = parsePath(target);
  let candidate = target;
  let attempt = 1;
  while (existsSync(candidate)) {
    candidate = join(dir, `${name} (${attempt})${ext}`);
    attempt += 1;
  }
  return candidate;
}

/**
 * Semua akses SSH terjadi di proses main. Renderer tidak pernah memegang
 * socket, private key, atau password — hanya menerima teks terminal dan
 * data yang sudah di-parse.
 */

const store = new SessionStore();
const connections = new ConnectionManager();
const monitor = new RemoteMonitor();
const appLock = new AppLock();
let edits: RemoteEditManager;
let localTerminals: LocalTerminalManager;

/** terminalId -> channel shell yang sedang terbuka. */
const shells = new Map<string, ClientChannel>();
/** tailId -> channel `tail -f` yang sedang berjalan. */
const logTails = new Map<string, ClientChannel>();
/** runId -> handle proses deploy yang sedang berjalan. */
const deployRuns = new Map<string, DeployRunHandle>();
/** Callback host key yang sedang menunggu jawaban pengguna. */
const pendingHostKeys = new Map<string, (trust: boolean) => void>();

/** Bungkus path dengan tanda kutip tunggal supaya aman dipakai di shell remote. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function resolveSession(id: string): Promise<{ config: SessionConfig; secret: Secret }> {
  const config = store.get(id);
  if (!config) throw new Error(`Session ${id} tidak ditemukan.`);
  return { config, secret: store.getSecret(id) };
}

export function registerIpc(window: BrowserWindow): void {
  const send = (channel: string, payload: unknown) => {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  };

  edits = new RemoteEditManager((status) => send('edit:status', status));

  localTerminals = new LocalTerminalManager(
    (terminalId, data) => send('local:data', { terminalId, data }),
    (terminalId, exitCode) => send('local:close', { terminalId, exitCode }),
  );

  // --- Kunci aplikasi -------------------------------------------------------
  ipcMain.handle('applock:status', () => appLock.status());
  ipcMain.handle('applock:setup', (_e, pin: string) => {
    appLock.setPin(pin);
    return appLock.status();
  });
  ipcMain.handle('applock:verify', (_e, pin: string) => appLock.verify(pin));
  ipcMain.handle('applock:changePin', (_e, currentPin: string, newPin: string) => {
    const result = appLock.verify(currentPin);
    if (!result.ok) return result;
    appLock.setPin(newPin);
    return { ok: true };
  });
  ipcMain.handle('applock:disable', (_e, currentPin: string) => {
    const result = appLock.verify(currentPin);
    if (!result.ok) return result;
    appLock.disable();
    return { ok: true };
  });
  ipcMain.handle('applock:relock', () => {
    appLock.relock();
    send('applock:changed', appLock.status());
  });
  ipcMain.handle('applock:setIdleMinutes', (_e, minutes: number) => {
    appLock.setIdleMinutes(minutes);
    return appLock.status();
  });

  // --- Preferensi SSH -------------------------------------------------------
  ipcMain.handle('settings:sshGet', () => preferences.get());
  ipcMain.handle('settings:sshUpdate', (_e, patch) => preferences.update(patch));
  ipcMain.handle('settings:sshReset', () => preferences.reset());

  // --- Preferensi SFTP ------------------------------------------------------
  ipcMain.handle('settings:sftpGet', () => sftpPreferences.get());
  ipcMain.handle('settings:sftpUpdate', (_e, patch) => sftpPreferences.update(patch));
  ipcMain.handle('settings:sftpReset', () => sftpPreferences.reset());
  ipcMain.handle('dialog:pickFolder', async () => {
    const result = await dialog.showOpenDialog(window, {
      title: 'Pilih folder unduhan default',
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  // --- Session CRUD -------------------------------------------------------
  // sessions:list dan ssh:connect digerbangi eksplisit: keduanya yang
  // membuka daftar server dan memakai password/passphrase tersimpan untuk
  // login sungguhan. Handler lain tidak menyentuh kredensial sama sekali,
  // atau baru bisa dipakai setelah sessionId hasil connect diketahui.
  ipcMain.handle('sessions:list', () => {
    if (appLock.isLocked()) throw new Error('Aplikasi terkunci.');
    return store.list();
  });
  ipcMain.handle('sessions:create', (_e, config, secret) => store.create(config, secret));
  ipcMain.handle('sessions:update', (_e, id, patch, secret) => store.update(id, patch, secret));
  ipcMain.handle('sessions:remove', (_e, id) => {
    store.remove(id);
    projects.removeProjectsForSession(id);
  });

  // --- Project & deploy template --------------------------------------------
  ipcMain.handle('projects:list', (_e, sessionId: string) => projects.listProjects(sessionId));
  ipcMain.handle('projects:create', (_e, sessionId: string, input) =>
    projects.createProject(sessionId, input),
  );
  ipcMain.handle('projects:update', (_e, id: string, patch) => projects.updateProject(id, patch));
  ipcMain.handle('projects:remove', (_e, id: string) => projects.removeProject(id));

  ipcMain.handle('templates:list', () => projects.listTemplates());
  ipcMain.handle('templates:create', (_e, input) => projects.createTemplate(input));
  ipcMain.handle('templates:update', (_e, id: string, patch) => projects.updateTemplate(id, patch));
  ipcMain.handle('templates:remove', (_e, id: string) => projects.removeTemplate(id));

  // --- Koneksi ------------------------------------------------------------
  /**
   * Dipasang sebelum connect dijalankan. Lihat catatan di
   * ConnectionManager.open — memasangnya setelah `await` membuat event
   * hostKeyPrompt dan status 'connected' terlewat, dan antarmuka menggantung
   * di "Menghubungkan…" selamanya meski koneksinya sebenarnya berhasil.
   */
  const bindConnection = (connection: SshConnection) => {
    const sessionId = connection.sessionId;
    const config = store.get(sessionId);

    connection.on('status', (status, detail) =>
      send('ssh:status', { sessionId, status, detail }),
    );

    connection.on('hostKeyPrompt', (info) => {
      const promptId = randomUUID();
      pendingHostKeys.set(promptId, (trust) => {
        if (trust && config) {
          void trustHostKey(config.host, config.port, info.keyType, info.rawKey);
        }
        info.accept(trust);
      });
      send('ssh:hostKeyPrompt', {
        promptId,
        sessionId,
        host: config?.host ?? '',
        port: config?.port ?? 22,
        keyType: info.keyType,
        fingerprint: info.fingerprint,
        storedFingerprint: info.storedFingerprint,
        changed: info.changed,
      });
    });
  };

  ipcMain.handle('ssh:connect', async (_e, sessionId: string) => {
    if (appLock.isLocked()) throw new Error('Aplikasi terkunci.');
    const { config, secret } = await resolveSession(sessionId);
    const connection = await connections.open(config, secret, resolveSession, bindConnection);
    store.touch(sessionId);
    // Nilai balik ini yang dipakai renderer sebagai status akhir, supaya
    // tidak bergantung pada event yang mungkin terjadi lebih dulu.
    return connection.getStatus();
  });

  ipcMain.handle('ssh:hostKeyResponse', (_e, promptId: string, trust: boolean) => {
    pendingHostKeys.get(promptId)?.(trust);
    pendingHostKeys.delete(promptId);
  });

  ipcMain.handle('ssh:disconnect', async (_e, sessionId: string) => {
    monitor.stop(sessionId);
    await edits.closeSession(sessionId);
    connections.close(sessionId);
  });

  /**
   * Query tanpa efek samping, dipakai renderer saat mount untuk menyamakan
   * status awal dengan koneksi yang mungkin masih hidup di main process
   * (mis. setelah reload window) — beda dari `ssh:connect` yang membuat
   * koneksi baru kalau belum ada.
   */
  ipcMain.handle('ssh:status', (_e, sessionId: string) => {
    return connections.get(sessionId)?.getStatus() ?? 'disconnected';
  });

  // --- Terminal -----------------------------------------------------------
  ipcMain.handle(
    'shell:open',
    async (_e, sessionId: string, cols: number, rows: number) => {
      const connection = connections.require(sessionId);
      const stream = await connection.openShell(cols, rows);
      const terminalId = randomUUID();
      shells.set(terminalId, stream);

      stream.on('data', (chunk: Buffer) =>
        send('shell:data', { terminalId, data: chunk.toString('utf8') }),
      );
      stream.stderr.on('data', (chunk: Buffer) =>
        send('shell:data', { terminalId, data: chunk.toString('utf8') }),
      );
      stream.on('close', () => {
        shells.delete(terminalId);
        send('shell:close', { terminalId });
      });

      return terminalId;
    },
  );

  ipcMain.on('shell:write', (_e, terminalId: string, data: string) => {
    shells.get(terminalId)?.write(data);
  });

  ipcMain.on('shell:resize', (_e, terminalId: string, cols: number, rows: number) => {
    // Server mengirim SIGWINCH ke proses foreground setelah menerima ini,
    // sehingga vim/htop/less ikut menyesuaikan ukuran.
    shells.get(terminalId)?.setWindow(rows, cols, 0, 0);
  });

  ipcMain.on('shell:close', (_e, terminalId: string) => {
    shells.get(terminalId)?.end();
    shells.delete(terminalId);
  });

  // --- Live log viewer ------------------------------------------------------
  // `tail -F` (huruf besar) mengikuti rotasi log (logrotate) — beda dari
  // `-f` yang berhenti kalau berkasnya diganti. -n 200 kasih konteks awal
  // supaya panel tidak polos kosong sebelum baris baru muncul.
  ipcMain.handle('log:open', async (_e, sessionId: string, path: string) => {
    const connection = connections.require(sessionId);
    const stream = await connection.execStream(`tail -F -n 200 -- ${shellQuote(path)}`);
    const tailId = randomUUID();
    logTails.set(tailId, stream);

    stream.on('data', (chunk: Buffer) =>
      send('log:data', { tailId, data: chunk.toString('utf8') }),
    );
    stream.stderr.on('data', (chunk: Buffer) =>
      send('log:data', { tailId, data: chunk.toString('utf8') }),
    );
    stream.on('close', () => {
      logTails.delete(tailId);
      send('log:close', { tailId });
    });

    return tailId;
  });

  ipcMain.on('log:close', (_e, tailId: string) => {
    logTails.get(tailId)?.close();
    logTails.delete(tailId);
  });

  // --- Terminal lokal Windows / WSL --------------------------------------
  ipcMain.handle('local:list', () => localTerminals.listProfiles());

  ipcMain.handle(
    'local:open',
    (_e, profileId: string, cols: number, rows: number) =>
      localTerminals.open(profileId, cols, rows),
  );

  ipcMain.on('local:write', (_e, terminalId: string, data: string) => {
    localTerminals.write(terminalId, data);
  });

  ipcMain.on('local:resize', (_e, terminalId: string, cols: number, rows: number) => {
    localTerminals.resize(terminalId, cols, rows);
  });

  ipcMain.on('local:close', (_e, terminalId: string) => {
    localTerminals.close(terminalId);
  });

  // --- SFTP browser -------------------------------------------------------

  ipcMain.handle('sftp:realpath', async (_e, sessionId: string, path: string) => {
    const sftp = await connections.require(sessionId).getSftp();
    return new Promise<string>((resolve, reject) => {
      sftp.realpath(path, (err, resolvedPath) => {
        if (err) return reject(err);
        resolve(resolvedPath);
      });
    });
  });

  ipcMain.handle('sftp:list', async (_e, sessionId: string, path: string) => {
    const sftp = await connections.require(sessionId).getSftp();
    return new Promise<RemoteFile[]>((resolve, reject) => {
      sftp.readdir(path, (err, entries) => {
        if (err) return reject(err);
        resolve(
          entries.map((entry) => ({
            name: entry.filename,
            path: path.endsWith('/') ? `${path}${entry.filename}` : `${path}/${entry.filename}`,
            isDirectory: entry.attrs.isDirectory(),
            isSymlink: entry.attrs.isSymbolicLink(),
            sizeBytes: entry.attrs.size,
            modifiedAt: entry.attrs.mtime * 1000,
            mode: (entry.attrs.mode & 0o7777).toString(8).padStart(4, '0'),
            owner: entry.attrs.uid,
            group: entry.attrs.gid,
          })),
        );
      });
    });
  });

  ipcMain.handle(
    'sftp:download',
    async (_e, sessionId: string, remotePath: string, localPath: string, sizeBytes: number) => {
      const sftp = await connections.require(sessionId).getSftp();
      const transferId = randomUUID();

      await new Promise<void>((resolve, reject) => {
        sftp.fastGet(
          remotePath,
          localPath,
          {
            // fastGet membuka beberapa request paralel — jauh lebih cepat
            // daripada stream tunggal pada koneksi berlatensi tinggi.
            concurrency: 8,
            chunkSize: 32 * 1024,
            step: (transferred) =>
              send('sftp:progress', {
                transferId,
                filename: remotePath.split('/').pop() ?? remotePath,
                transferredBytes: transferred,
                totalBytes: sizeBytes,
                direction: 'download' as const,
              }),
          },
          (err) => (err ? reject(err) : resolve()),
        );
      });

      return transferId;
    },
  );

  ipcMain.handle(
    'sftp:upload',
    async (_e, sessionId: string, localPath: string, remotePath: string) => {
      const sftp = await connections.require(sessionId).getSftp();
      await new Promise<void>((resolve, reject) => {
        sftp.fastPut(localPath, remotePath, { concurrency: 8 }, (err) =>
          err ? reject(err) : resolve(),
        );
      });
    },
  );

  ipcMain.handle('sftp:remove', async (_e, sessionId: string, path: string, isDir: boolean) => {
    const sftp = await connections.require(sessionId).getSftp();
    await new Promise<void>((resolve, reject) => {
      const done = (err: Error | null | undefined) => (err ? reject(err) : resolve());
      isDir ? sftp.rmdir(path, done) : sftp.unlink(path, done);
    });
  });

  ipcMain.handle('sftp:rename', async (_e, sessionId: string, from: string, to: string) => {
    const sftp = await connections.require(sessionId).getSftp();
    await new Promise<void>((resolve, reject) => {
      sftp.rename(from, to, (err) => (err ? reject(err) : resolve()));
    });
  });

  // --- Import ~/.ssh/config ------------------------------------------------
  ipcMain.handle('sshconfig:scan', async () => {
    const parsed = await parseSshConfig();
    const existing = store.list();
    // Tandai host yang sudah punya session dengan host+port+user sama,
    // supaya UI bisa menonaktifkannya alih-alih membuat duplikat.
    return parsed.map((entry) => ({
      ...entry,
      alreadyImported: existing.some(
        (session) =>
          session.host === entry.host &&
          session.port === entry.port &&
          session.username === (entry.username ?? session.username),
      ),
    }));
  });

  ipcMain.handle('sshconfig:import', async (_e, aliases: string[], group?: string) => {
    const parsed = await parseSshConfig();
    const selected = parsed.filter((entry) => aliases.includes(entry.alias));

    // Dua tahap: buat semua session dulu, baru sambungkan ProxyJump —
    // sebuah bastion bisa muncul setelah server yang memakainya.
    const created = new Map<string, string>();
    for (const entry of selected) {
      const session = store.create({
        name: entry.alias,
        host: entry.host,
        port: entry.port,
        username: entry.username ?? 'root',
        authMethod: entry.identityFile ? 'privateKey' : 'agent',
        privateKeyPath: entry.identityFile,
        group: group?.trim() || undefined,
      });
      created.set(entry.alias, session.id);
    }

    let linked = 0;
    for (const entry of selected) {
      if (!entry.proxyJump) continue;
      const jumpHostId = created.get(entry.proxyJump);
      if (!jumpHostId) continue;
      store.update(created.get(entry.alias)!, { jumpHostId });
      linked += 1;
    }

    return { imported: created.size, linked };
  });

  // --- Dialog file lokal --------------------------------------------------
  // Dialog dibuka dari proses main supaya renderer tidak pernah menyusun
  // path sendiri; ia hanya menerima path yang benar-benar dipilih pengguna.
  ipcMain.handle('dialog:pickUpload', async () => {
    const result = await dialog.showOpenDialog(window, {
      title: 'Pilih berkas untuk diunggah',
      properties: ['openFile', 'multiSelections'],
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle('dialog:pickDownload', async (_e, suggestedName: string) => {
    const prefs = sftpPreferences.get();

    // Belum ada folder default, atau kebijakannya memang "tanya" — pakai
    // dialog native seperti sebelumnya (sudah punya konfirmasi timpa bawaan
    // OS). Folder default cuma dipakai sebagai lokasi awal dialog.
    if (!prefs.downloadFolder || prefs.downloadConflict === 'ask') {
      const result = await dialog.showSaveDialog(window, {
        title: 'Simpan berkas',
        defaultPath: prefs.downloadFolder
          ? join(prefs.downloadFolder, suggestedName)
          : suggestedName,
      });
      return result.canceled ? null : result.filePath;
    }

    const target = join(prefs.downloadFolder, suggestedName);
    if (!existsSync(target)) return target;

    switch (prefs.downloadConflict) {
      case 'skip':
        return null;
      case 'rename':
        return uniqueLocalPath(target);
      case 'overwrite':
      default:
        return target;
    }
  });

  // --- Edit berkas remote --------------------------------------------------
  ipcMain.handle(
    'edit:open',
    (_e, sessionId: string, remotePath: string, sizeBytes: number) =>
      edits.open(sessionId, connections.require(sessionId), remotePath, sizeBytes),
  );

  ipcMain.handle('edit:list', (_e, sessionId?: string) => edits.list(sessionId));
  ipcMain.handle('edit:close', (_e, editId: string) => edits.close(editId));

  // --- Monitor ------------------------------------------------------------
  ipcMain.handle('monitor:start', (_e, sessionId: string, intervalMs = 2000) => {
    const connection = connections.require(sessionId);
    monitor.start(
      sessionId,
      connection,
      intervalMs,
      (snapshot) => send('monitor:snapshot', { sessionId, snapshot }),
      (error) => send('monitor:error', { sessionId, message: error.message }),
    );
  });

  ipcMain.handle('monitor:stop', (_e, sessionId: string) => monitor.stop(sessionId));

  // --- Service manager (systemd) ---------------------------------------------
  ipcMain.handle('service:list', (_e, sessionId: string) =>
    listServices(connections.require(sessionId)),
  );
  ipcMain.handle(
    'service:action',
    (_e, sessionId: string, unit: string, action: ServiceAction) =>
      runServiceAction(connections.require(sessionId), unit, action),
  );

  // --- Git remote ------------------------------------------------------------
  ipcMain.handle('git:status', (_e, sessionId: string, path: string) =>
    getGitStatus(connections.require(sessionId), path),
  );
  ipcMain.handle('git:action', (_e, sessionId: string, path: string, action: GitAction) =>
    runGitAction(connections.require(sessionId), path, action),
  );

  // --- Deploy ------------------------------------------------------------
  ipcMain.handle('deploy:run', async (_e, sessionId: string, projectId: string) => {
    const project = projects.getProject(projectId);
    if (!project) throw new Error('Project tidak ditemukan.');
    if (!project.deployTemplateId) {
      throw new Error('Project ini belum dipasangkan ke deploy template.');
    }
    const template = projects.getTemplate(project.deployTemplateId);
    if (!template) throw new Error('Deploy template tidak ditemukan.');
    if (template.steps.length === 0) throw new Error('Deploy template ini belum punya langkah.');

    const connection = connections.require(sessionId);
    const runId = randomUUID();

    const handle = runDeploy(connection, project.path, project.env, template.steps, {
      onStepStart: (stepIndex, stepLabel) =>
        send('deploy:event', { runId, type: 'stepStart', stepIndex, stepLabel }),
      onOutput: (data) => send('deploy:event', { runId, type: 'output', data }),
      onStepEnd: (stepIndex, exitCode) =>
        send('deploy:event', { runId, type: 'stepEnd', stepIndex, exitCode }),
      onDone: (success, message) => {
        deployRuns.delete(runId);
        send('deploy:event', { runId, type: 'done', success, message });
      },
    });
    deployRuns.set(runId, handle);

    return runId;
  });

  ipcMain.on('deploy:cancel', (_e, runId: string) => {
    deployRuns.get(runId)?.cancel();
    deployRuns.delete(runId);
  });
}

export function shutdown(): void {
  edits?.closeAll();
  for (const stream of shells.values()) stream.end();
  shells.clear();
  for (const handle of deployRuns.values()) handle.cancel();
  deployRuns.clear();
  connections.closeAll();
  store.close();
}
