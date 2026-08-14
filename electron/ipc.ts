import { randomUUID } from 'node:crypto';
import { dialog, ipcMain, type BrowserWindow } from 'electron';
import type { ClientChannel } from 'ssh2';

import { ConnectionManager, type SshConnection } from './ssh/connection-manager';
import { RemoteMonitor } from './ssh/monitor';
import { trustHostKey } from './ssh/known-hosts';
import { parseSshConfig } from './ssh/ssh-config';
import { RemoteEditManager } from './ssh/remote-edit';
import { SessionStore } from './store/sessions';
import { LocalTerminalManager } from './local-terminal';
import type { RemoteFile, SessionConfig, Secret } from '../src/shared/types';

/**
 * Semua akses SSH terjadi di proses main. Renderer tidak pernah memegang
 * socket, private key, atau password — hanya menerima teks terminal dan
 * data yang sudah di-parse.
 */

const store = new SessionStore();
const connections = new ConnectionManager();
const monitor = new RemoteMonitor();
let edits: RemoteEditManager;
let localTerminals: LocalTerminalManager;

/** terminalId -> channel shell yang sedang terbuka. */
const shells = new Map<string, ClientChannel>();
/** Callback host key yang sedang menunggu jawaban pengguna. */
const pendingHostKeys = new Map<string, (trust: boolean) => void>();

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

  // --- Session CRUD -------------------------------------------------------
  ipcMain.handle('sessions:list', () => store.list());
  ipcMain.handle('sessions:create', (_e, config, secret) => store.create(config, secret));
  ipcMain.handle('sessions:update', (_e, id, patch, secret) => store.update(id, patch, secret));
  ipcMain.handle('sessions:remove', (_e, id) => store.remove(id));

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
    const result = await dialog.showSaveDialog(window, {
      title: 'Simpan berkas',
      defaultPath: suggestedName,
    });
    return result.canceled ? null : result.filePath;
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
}

export function shutdown(): void {
  edits?.closeAll();
  for (const stream of shells.values()) stream.end();
  shells.clear();
  connections.closeAll();
  store.close();
}
