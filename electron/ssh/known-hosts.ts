import { createHmac, createHash } from 'node:crypto';
import { readFile, appendFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

/**
 * Verifikasi host key terhadap ~/.ssh/known_hosts.
 *
 * Ini bagian yang paling sering di-bypass orang dengan `hostVerifier: () => true`.
 * Tanpa verifikasi, koneksi SSH kehilangan proteksi terhadap man-in-the-middle:
 * enkripsi tetap jalan, tapi kita tidak tahu sedang bicara dengan siapa.
 */

const KNOWN_HOSTS_PATH = join(homedir(), '.ssh', 'known_hosts');

export type VerifyResult =
  | { status: 'trusted' }
  | { status: 'unknown'; fingerprint: string }
  | { status: 'changed'; fingerprint: string; storedFingerprint: string };

interface KnownHostEntry {
  /** Pola host apa adanya, atau null jika entri di-hash. */
  pattern: string | null;
  hashSalt?: Buffer;
  hashValue?: Buffer;
  keyType: string;
  keyBase64: string;
}

/** Format sama dengan `ssh-keygen -lf`: "SHA256:<base64 tanpa padding>". */
export function fingerprint(key: Buffer): string {
  const digest = createHash('sha256').update(key).digest('base64');
  return `SHA256:${digest.replace(/=+$/, '')}`;
}

function hostToken(host: string, port: number): string {
  // OpenSSH menulis port non-standar sebagai "[host]:port".
  return port === 22 ? host : `[${host}]:${port}`;
}

function parseLine(line: string): KnownHostEntry | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;

  const parts = trimmed.split(/\s+/);
  // Lewati marker seperti @cert-authority / @revoked.
  const fields = parts[0].startsWith('@') ? parts.slice(1) : parts;
  if (fields.length < 3) return null;

  const [hosts, keyType, keyBase64] = fields;

  if (hosts.startsWith('|1|')) {
    const [, saltB64, hashB64] = hosts.split('|').filter(Boolean);
    if (!saltB64 || !hashB64) return null;
    return {
      pattern: null,
      hashSalt: Buffer.from(saltB64, 'base64'),
      hashValue: Buffer.from(hashB64, 'base64'),
      keyType,
      keyBase64,
    };
  }

  return { pattern: hosts, keyType, keyBase64 };
}

function entryMatchesHost(entry: KnownHostEntry, token: string): boolean {
  if (entry.hashSalt && entry.hashValue) {
    const computed = createHmac('sha1', entry.hashSalt).update(token).digest();
    return computed.equals(entry.hashValue);
  }
  // Satu baris bisa memuat beberapa host dipisah koma.
  return (entry.pattern ?? '').split(',').some((p) => p === token);
}

async function loadEntries(): Promise<KnownHostEntry[]> {
  try {
    const raw = await readFile(KNOWN_HOSTS_PATH, 'utf8');
    return raw.split('\n').map(parseLine).filter((e): e is KnownHostEntry => e !== null);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

export async function verifyHostKey(
  host: string,
  port: number,
  key: Buffer,
): Promise<VerifyResult> {
  const token = hostToken(host, port);
  const presented = key.toString('base64');
  const entries = await loadEntries();

  const matches = entries.filter((e) => entryMatchesHost(e, token));
  if (matches.length === 0) {
    return { status: 'unknown', fingerprint: fingerprint(key) };
  }

  if (matches.some((e) => e.keyBase64 === presented)) {
    return { status: 'trusted' };
  }

  // Host dikenal tapi key berbeda. Ini bisa berarti server di-reinstall,
  // atau ada yang menyadap. Jangan pernah diterima diam-diam.
  const stored = Buffer.from(matches[0].keyBase64, 'base64');
  return {
    status: 'changed',
    fingerprint: fingerprint(key),
    storedFingerprint: fingerprint(stored),
  };
}

export async function trustHostKey(
  host: string,
  port: number,
  keyType: string,
  key: Buffer,
): Promise<void> {
  await mkdir(dirname(KNOWN_HOSTS_PATH), { recursive: true, mode: 0o700 });
  const line = `${hostToken(host, port)} ${keyType} ${key.toString('base64')}\n`;
  await appendFile(KNOWN_HOSTS_PATH, line, { mode: 0o600 });
}
