import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import * as pty from 'node-pty';
import type { IPty } from 'node-pty';

import type {
  LocalCliAvailability,
  LocalCliProfile,
  LocalTerminalOpenOptions,
  LocalTerminalProfile,
} from '../src/shared/types';

type LocalDataHandler = (terminalId: string, data: string) => void;
type LocalCloseHandler = (terminalId: string, exitCode: number) => void;

function resolveExecutablePath(name: string): string | undefined {
  const result = spawnSync('where.exe', [name], {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 1500,
  });

  if (result.status !== 0 || !result.stdout) return undefined;

  return result.stdout
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);
}

function executableExists(name: string): boolean {
  return Boolean(resolveExecutablePath(name));
}

function stripAnsiForHealth(value: string): string {
  return value
    .replace(/\x1B\[[0-?]*[ -\/]*[@-~]/g, '')
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, '')
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

const BUILTIN_VERSION_COMMANDS: Record<string, string> = {
  omp: 'omp',
  codex: 'codex',
  claude: 'claude',
};

function canProbeBuiltinVersion(profile: LocalCliProfile): boolean {
  const expected = BUILTIN_VERSION_COMMANDS[profile.id];
  if (!expected || profile.source !== 'builtin') return false;

  const command = profile.command.trim().toLowerCase();
  return command === expected || command === `${expected}.exe`;
}

function probeCliVersion(
  profile: LocalCliProfile,
  resolvedPath: string,
): { version?: string; versionStatus: LocalCliAvailability['versionStatus'] } {
  if (!canProbeBuiltinVersion(profile) || !profile.enabled) {
    return { versionStatus: 'skipped' };
  }

  let result = spawnSync(resolvedPath, ['--version'], {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 2500,
  });

  if (result.error && /\.(?:cmd|bat)$/i.test(resolvedPath)) {
    const comspec = process.env.ComSpec || 'cmd.exe';
    result = spawnSync(comspec, ['/d', '/s', '/c', `"${resolvedPath}" --version`], {
      windowsHide: true,
      encoding: 'utf8',
      timeout: 2500,
    });
  }

  const raw = `${result.stdout ?? ''} ${result.stderr ?? ''}`;
  const version = stripAnsiForHealth(raw).slice(0, 180);
  if (result.status === 0 && version) {
    return { version, versionStatus: 'detected' };
  }

  return { versionStatus: 'failed' };
}

function decodeWindowsOutput(buffer: Buffer): string {
  if (buffer.length === 0) return '';

  const hasNull = buffer.includes(0);
  return (hasNull ? buffer.toString('utf16le') : buffer.toString('utf8'))
    .replace(/\u0000/g, '')
    .replace(/\r/g, '');
}

function listWslDistros(): string[] {
  if (!executableExists('wsl.exe')) return [];

  const result = spawnSync('wsl.exe', ['--list', '--quiet'], {
    windowsHide: true,
    encoding: 'buffer',
  });

  if (result.status !== 0 || !result.stdout) return [];

  return decodeWindowsOutput(result.stdout)
    .split('\n')
    .map((name) => name.trim())
    .filter(Boolean)
    .filter((name, index, all) => all.indexOf(name) === index);
}

function environment(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') result[key] = value;
  }

  result.TERM = 'xterm-256color';
  result.COLORTERM = 'truecolor';
  return result;
}

function validatedCwd(requested?: string): string {
  if (!requested) return homedir();
  if (!isAbsolute(requested)) throw new Error('Working directory terminal harus path absolut.');

  const cwd = resolve(requested);
  try {
    if (!statSync(cwd).isDirectory()) {
      throw new Error('Working directory terminal bukan directory.');
    }
  } catch (err) {
    if (err instanceof Error && err.message === 'Working directory terminal bukan directory.') {
      throw err;
    }
    throw new Error(`Working directory terminal tidak tersedia: ${requested}`);
  }

  return cwd;
}

function cliInvocation(profile: LocalCliProfile): string {
  return [profile.command, ...profile.args].join(' ');
}

const OMP_COMPAT_SSH_CONNECTION = '127.0.0.1 0 127.0.0.1 0';

function isOmpCli(profile: LocalCliProfile): boolean {
  const command = profile.command.trim().toLowerCase();
  return command === 'omp' || command === 'omp.exe';
}

/**
 * OMP 18.4.9+ may enable Windows console win32-input-mode (CSI ? 9001 h)
 * when it sees a native Windows + ConPTY session. ASProOps is actually an
 * xterm.js frontend over ConPTY, so it keeps sending normal VT key sequences;
 * OMP then splits arrows into Escape + literal "[A"/"[B"/etc.
 *
 * OMP deliberately skips that host-local input mode when SSH_* is present.
 * We reproduce the proven workaround only for an OMP registry launch and
 * scope it to the lifetime of that one command. The shell environment is
 * restored after OMP exits.
 */
function cliStartupCommand(
  cliProfile: LocalCliProfile,
  terminalProfile: LocalTerminalProfile,
): string {
  const invocation = cliInvocation(cliProfile);

  if (
    process.platform !== 'win32' ||
    terminalProfile.kind === 'wsl' ||
    !isOmpCli(cliProfile)
  ) {
    return invocation;
  }

  if (terminalProfile.kind === 'powershell') {
    return [
      '$__asproopsPrevSshConnection=$env:SSH_CONNECTION',
      `$env:SSH_CONNECTION='${OMP_COMPAT_SSH_CONNECTION}'`,
      `try { ${invocation} } finally {`,
      'if ($null -eq $__asproopsPrevSshConnection) {',
      'Remove-Item Env:SSH_CONNECTION -ErrorAction SilentlyContinue',
      '} else {',
      '$env:SSH_CONNECTION=$__asproopsPrevSshConnection',
      '}',
      'Remove-Variable __asproopsPrevSshConnection -ErrorAction SilentlyContinue',
      '}',
    ].join('; ');
  }

  if (terminalProfile.kind === 'cmd') {
    // SETLOCAL/ENDLOCAL restores an existing SSH_CONNECTION automatically,
    // including the previously-unset case.
    return [
      'setlocal',
      `set "SSH_CONNECTION=${OMP_COMPAT_SSH_CONNECTION}"`,
      invocation,
      'endlocal',
    ].join(' & ');
  }

  return invocation;
}

export class LocalTerminalManager {
  private readonly terminals = new Map<string, IPty>();
  private readonly cliHealthCache = new Map<
    string,
    { checkedAt: number; value: LocalCliAvailability }
  >();

  constructor(
    private readonly onData: LocalDataHandler,
    private readonly onClose: LocalCloseHandler,
  ) {}

  commandAvailable(command: string): boolean {
    return executableExists(command);
  }

  inspectCli(profile: LocalCliProfile, force = false): LocalCliAvailability {
    const cacheKey = [
      profile.id,
      profile.command,
      profile.enabled ? '1' : '0',
      String(profile.updatedAt),
    ].join('|');
    const cached = this.cliHealthCache.get(cacheKey);

    if (!force && cached && Date.now() - cached.checkedAt < 60_000) {
      return { ...cached.value, args: [...cached.value.args] };
    }

    const resolvedPath = resolveExecutablePath(profile.command);
    const available = profile.enabled && Boolean(resolvedPath);
    const versionResult = resolvedPath
      ? probeCliVersion(profile, resolvedPath)
      : { versionStatus: 'skipped' as const };

    const value: LocalCliAvailability = {
      ...profile,
      args: [...profile.args],
      available,
      status: !profile.enabled ? 'disabled' : available ? 'available' : 'not_found',
      ...(resolvedPath ? { resolvedPath } : {}),
      ...versionResult,
    };

    this.cliHealthCache.set(cacheKey, { checkedAt: Date.now(), value });
    return { ...value, args: [...value.args] };
  }

  clearCliHealthCache(): void {
    this.cliHealthCache.clear();
  }

  listProfiles(): LocalTerminalProfile[] {
    const profiles: LocalTerminalProfile[] = [];

    if (executableExists('pwsh.exe')) {
      profiles.push({
        id: 'powershell7',
        name: 'PowerShell 7',
        kind: 'powershell',
        command: 'pwsh.exe',
        args: ['-NoLogo'],
        detail: 'PowerShell modern',
      });
    }

    if (executableExists('powershell.exe')) {
      profiles.push({
        id: 'windows-powershell',
        name: 'Windows PowerShell',
        kind: 'powershell',
        command: 'powershell.exe',
        args: ['-NoLogo'],
        detail: 'Windows PowerShell 5.x',
      });
    }

    if (executableExists('cmd.exe')) {
      profiles.push({
        id: 'cmd',
        name: 'Command Prompt',
        kind: 'cmd',
        command: 'cmd.exe',
        args: [],
        detail: 'cmd.exe',
      });
    }

    for (const distro of listWslDistros()) {
      profiles.push({
        id: `wsl:${distro}`,
        name: distro,
        kind: 'wsl',
        command: 'wsl.exe',
        args: ['--distribution', distro],
        detail: 'Windows Subsystem for Linux',
      });
    }

    return profiles;
  }

  open(options: LocalTerminalOpenOptions, cliProfile?: LocalCliProfile): string {
    const profile = this.listProfiles().find((item) => item.id === options.profileId);
    if (!profile) {
      throw new Error(`Terminal lokal "${options.profileId}" tidak tersedia.`);
    }

    const cwd = validatedCwd(options.cwd);

    if (options.cliProfileId && !cliProfile) {
      throw new Error('CLI profile tidak dapat di-resolve oleh main process.');
    }
    if (cliProfile && options.cliProfileId !== cliProfile.id) {
      throw new Error('CLI profile tidak cocok dengan request terminal.');
    }
    if (cliProfile && !this.commandAvailable(cliProfile.command)) {
      throw new Error(`${cliProfile.name} tidak tersedia di PATH Windows.`);
    }

    const cols = Math.max(20, Math.floor(Number(options.cols) || 80));
    const rows = Math.max(5, Math.floor(Number(options.rows) || 24));

    const terminalId = randomUUID();
    const terminal = pty.spawn(profile.command, profile.args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: environment(),
      useConpty: true,
    });

    this.terminals.set(terminalId, terminal);

    let startupSent = cliProfile === undefined;
    let startupTimer: ReturnType<typeof setTimeout> | null = null;

    const sendStartupCommand = () => {
      if (startupSent || !cliProfile) return;
      startupSent = true;
      if (startupTimer) {
        clearTimeout(startupTimer);
        startupTimer = null;
      }

      // command + args berasal dari registry main-process yang sudah
      // divalidasi, bukan string command yang dikirim renderer saat launch.
      // OMP mendapat wrapper compatibility terbatas di sini; CLI lain tetap
      // menerima invocation normal.
      terminal.write(`${cliStartupCommand(cliProfile, profile)}\r`);
    };

    if (cliProfile) {
      startupTimer = setTimeout(sendStartupCommand, 400);
    }

    terminal.onData((data) => {
      this.onData(terminalId, data);

      if (!startupSent && cliProfile) {
        if (startupTimer) clearTimeout(startupTimer);
        startupTimer = setTimeout(sendStartupCommand, 40);
      }
    });

    terminal.onExit(({ exitCode }) => {
      if (startupTimer) clearTimeout(startupTimer);
      this.terminals.delete(terminalId);
      this.onClose(terminalId, exitCode);
    });

    return terminalId;
  }

  write(terminalId: string, data: string): void {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) throw new Error('Terminal lokal sudah ditutup.');
    terminal.write(data);
  }

  resize(terminalId: string, cols: number, rows: number): void {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) return;
    terminal.resize(Math.max(20, cols), Math.max(5, rows));
  }

  close(terminalId: string): void {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) return;

    this.terminals.delete(terminalId);
    try {
      terminal.kill();
    } catch {
      // Sudah keluar.
    }
  }

  closeAll(): void {
    for (const terminalId of [...this.terminals.keys()]) {
      this.close(terminalId);
    }
  }
}
