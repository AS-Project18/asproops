import { readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname, isAbsolute, resolve } from 'node:path';

/**
 * Pembaca `~/.ssh/config`.
 *
 * Ini bukan implementasi penuh spesifikasi OpenSSH — hanya bagian yang
 * relevan untuk mengisi daftar server: alias host, tujuan sebenarnya,
 * pengguna, port, kunci, dan bastion. Directive lain diabaikan, bukan
 * dianggap error, supaya berkas config yang rumit tetap bisa dibaca.
 */

export interface SshConfigHost {
  /** Nama di baris `Host` — dipakai sebagai nama session. */
  alias: string;
  host: string;
  port: number;
  username?: string;
  identityFile?: string;
  /** Nilai `ProxyJump`, masih berupa alias — belum diterjemahkan ke id. */
  proxyJump?: string;
}

const CONFIG_PATH = join(homedir(), '.ssh', 'config');

/** Batas kedalaman Include supaya berkas yang saling menyertakan tidak berputar. */
const MAX_INCLUDE_DEPTH = 5;

function expandHome(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2));
  return path;
}

/** Baris config bisa memakai `Key value` atau `Key=value`. */
function splitDirective(line: string): [string, string] | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  const match = trimmed.match(/^(\S+?)\s*(?:=|\s)\s*(.+)$/);
  if (!match) return null;
  return [match[1].toLowerCase(), match[2].trim().replace(/^"(.*)"$/, '$1')];
}

/**
 * `Include` menerima pola glob. Menghindari dependensi glob, hanya pola
 * sederhana `dir/*` dan path literal yang didukung — itu mencakup bentuk
 * yang hampir selalu dipakai orang, yaitu `Include config.d/*`.
 */
async function resolveInclude(pattern: string, baseDir: string): Promise<string[]> {
  const expanded = expandHome(pattern);
  const absolute = isAbsolute(expanded) ? expanded : resolve(baseDir, expanded);

  if (!absolute.includes('*')) return [absolute];

  const dir = dirname(absolute);
  const suffix = absolute.slice(dir.length + 1).replace('*', '');
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
      .map((entry) => join(dir, entry.name));
  } catch {
    return [];
  }
}

async function readLines(path: string, depth: number): Promise<string[]> {
  if (depth > MAX_INCLUDE_DEPTH) return [];

  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return [];
  }

  const output: string[] = [];
  for (const line of raw.split('\n')) {
    const directive = splitDirective(line);
    if (directive?.[0] === 'include') {
      for (const included of await resolveInclude(directive[1], dirname(path))) {
        output.push(...(await readLines(included, depth + 1)));
      }
    } else {
      output.push(line);
    }
  }
  return output;
}

export async function parseSshConfig(path = CONFIG_PATH): Promise<SshConfigHost[]> {
  const lines = await readLines(path, 0);

  // Nilai di bawah `Host *` berlaku sebagai default untuk semua host.
  const defaults: Partial<SshConfigHost> = {};
  const hosts = new Map<string, Partial<SshConfigHost>>();
  let current: Array<Partial<SshConfigHost>> = [];

  for (const line of lines) {
    const directive = splitDirective(line);
    if (!directive) continue;
    const [key, value] = directive;

    if (key === 'host') {
      current = [];
      for (const pattern of value.split(/\s+/)) {
        // Pola dengan wildcard bukan host konkret — nilainya jadi default,
        // bukan entri yang bisa diimpor.
        if (pattern.includes('*') || pattern.includes('?') || pattern.startsWith('!')) {
          if (pattern === '*') current.push(defaults);
          continue;
        }
        const entry = hosts.get(pattern) ?? { alias: pattern };
        hosts.set(pattern, entry);
        current.push(entry);
      }
      continue;
    }

    // `Match` memulai blok bersyarat yang tidak kita evaluasi — hentikan
    // penulisan sampai bertemu `Host` berikutnya agar nilainya tidak bocor.
    if (key === 'match') {
      current = [];
      continue;
    }

    for (const entry of current) {
      switch (key) {
        case 'hostname':
          entry.host ??= value;
          break;
        case 'user':
          entry.username ??= value;
          break;
        case 'port':
          entry.port ??= Number(value);
          break;
        case 'identityfile':
          entry.identityFile ??= expandHome(value);
          break;
        case 'proxyjump':
          // Bentuk `user@host:port` disederhanakan jadi alias saja.
          entry.proxyJump ??= value.split(',')[0].split('@').pop()?.split(':')[0];
          break;
      }
    }
  }

  return [...hosts.values()]
    .filter((entry): entry is SshConfigHost & { alias: string } => Boolean(entry.alias))
    .map((entry) => ({
      alias: entry.alias,
      // Tanpa HostName, alias itu sendiri adalah nama host yang dituju.
      host: entry.host ?? defaults.host ?? entry.alias,
      port: entry.port ?? defaults.port ?? 22,
      username: entry.username ?? defaults.username,
      identityFile: entry.identityFile ?? defaults.identityFile,
      proxyJump: entry.proxyJump,
    }))
    .sort((a, b) => a.alias.localeCompare(b.alias));
}
