import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as pty from 'node-pty';
import type { IPty } from 'node-pty';

import type { LocalTerminalProfile } from '../src/shared/types';

type LocalDataHandler = (terminalId: string, data: string) => void;
type LocalCloseHandler = (terminalId: string, exitCode: number) => void;

function executableExists(name: string): boolean {
  const result = spawnSync('where.exe', [name], {
    windowsHide: true,
    stdio: 'ignore',
  });
  return result.status === 0;
}

function decodeWindowsOutput(buffer: Buffer): string {
  if (buffer.length === 0) return '';

  // Beberapa build wsl.exe menulis output UTF-16LE. NUL byte adalah sinyal
  // yang cukup aman untuk membedakannya dari UTF-8/ANSI normal.
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

export class LocalTerminalManager {
  private readonly terminals = new Map<string, IPty>();

  constructor(
    private readonly onData: LocalDataHandler,
    private readonly onClose: LocalCloseHandler,
  ) {}

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

  open(profileId: string, cols: number, rows: number): string {
    const profile = this.listProfiles().find((item) => item.id === profileId);
    if (!profile) {
      throw new Error(`Terminal lokal "${profileId}" tidak tersedia.`);
    }

    const terminalId = randomUUID();
    const terminal = pty.spawn(profile.command, profile.args, {
      name: 'xterm-256color',
      cols: Math.max(20, cols),
      rows: Math.max(5, rows),
      cwd: homedir(),
      env: environment(),
      useConpty: true,
    });

    this.terminals.set(terminalId, terminal);

    terminal.onData((data) => this.onData(terminalId, data));
    terminal.onExit(({ exitCode }) => {
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
