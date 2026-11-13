import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { SessionChannels } from './connection-manager';
import type { SshKeyGenerateInput, SshKeyInfo } from '../../src/shared/types';

const execFileAsync = promisify(execFile);

export function getSshDir(): string {
  return path.join(os.homedir(), '.ssh');
}

/** Menghitung fingerprint SHA256 standar OpenSSH dari base64 public key. */
export function computeFingerprint(base64Key: string): string {
  try {
    const raw = Buffer.from(base64Key, 'base64');
    const hash = crypto.createHash('sha256').update(raw).digest('base64').replace(/=+$/, '');
    return `SHA256:${hash}`;
  } catch {
    return '';
  }
}

/** Membaca semua keypair SSH yang ada di folder ~/.ssh milik pengguna. */
export async function listLocalSshKeys(): Promise<SshKeyInfo[]> {
  const dir = getSshDir();
  if (!fs.existsSync(dir)) {
    return [];
  }

  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  const result: SshKeyInfo[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.pub')) continue;

    const pubName = entry.name;
    const baseName = pubName.slice(0, -4);
    const pubPath = path.join(dir, pubName);
    const privPath = path.join(dir, baseName);

    try {
      const pubContent = (await fs.promises.readFile(pubPath, 'utf8')).trim();
      const parts = pubContent.split(/\s+/);
      const rawType = parts[0] || 'unknown';
      const keyBase64 = parts[1] || '';
      const comment = parts.slice(2).join(' ');

      let displayType = rawType.replace(/^ssh-/, '').toUpperCase();
      if (rawType.includes('ed25519')) displayType = 'ED25519';
      else if (rawType.includes('rsa')) displayType = 'RSA';
      else if (rawType.includes('ecdsa')) displayType = 'ECDSA';

      const stat = await fs.promises.stat(pubPath);
      const hasPrivate = fs.existsSync(privPath);

      result.push({
        name: baseName,
        privateKeyPath: hasPrivate ? privPath : '',
        publicKeyPath: pubPath,
        publicKeyContent: pubContent,
        type: displayType,
        fingerprint: computeFingerprint(keyBase64),
        comment: comment || undefined,
        createdAt: stat.birthtimeMs || stat.mtimeMs,
      });
    } catch {
      // Abaikan berkas .pub yang korup atau tidak terbaca
    }
  }

  // Urutkan berdasarkan waktu modifikasi terbaru lebih dulu
  return result.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

/** Membuat keypair SSH baru menggunakan utilitas bawaan OS (ssh-keygen). */
export async function generateSshKeyPair(input: SshKeyGenerateInput): Promise<SshKeyInfo> {
  const sanitizedName = input.name.trim().replace(/[^a-zA-Z0-9_-]/g, '');
  if (!sanitizedName) {
    throw new Error('Nama berkas kunci hanya boleh mengandung huruf, angka, tanda minus, dan garis bawah.');
  }

  const dir = getSshDir();
  if (!fs.existsSync(dir)) {
    await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
  }

  const privPath = path.join(dir, sanitizedName);
  const pubPath = `${privPath}.pub`;

  if (fs.existsSync(privPath) || fs.existsSync(pubPath)) {
    throw new Error(`Kunci dengan nama "${sanitizedName}" sudah ada di ${dir}.`);
  }

  const algorithm = input.algorithm === 'rsa' ? 'rsa' : 'ed25519';
  const comment = (input.comment?.trim() || `${os.userInfo().username}@${os.hostname()}`).replace(/["'\\]/g, '');
  const passphrase = input.passphrase || '';

  const args: string[] = ['-t', algorithm];
  if (algorithm === 'rsa') {
    args.push('-b', '4096');
  }
  args.push('-C', comment);
  args.push('-f', privPath);
  args.push('-N', passphrase);
  args.push('-q');

  try {
    await execFileAsync('ssh-keygen', args, { windowsHide: true });
  } catch (err) {
    throw new Error(`Gagal menjalankan ssh-keygen: ${(err as Error).message}`);
  }

  // Pastikan izin berkas private key di Windows/Linux tetap terkunci
  try {
    await fs.promises.chmod(privPath, 0o600);
    await fs.promises.chmod(pubPath, 0o644);
  } catch {
    /* ignore chmod errors on Windows NTFS */
  }

  const pubContent = (await fs.promises.readFile(pubPath, 'utf8')).trim();
  const parts = pubContent.split(/\s+/);
  const keyBase64 = parts[1] || '';

  return {
    name: sanitizedName,
    privateKeyPath: privPath,
    publicKeyPath: pubPath,
    publicKeyContent: pubContent,
    type: algorithm.toUpperCase(),
    fingerprint: computeFingerprint(keyBase64),
    comment,
    createdAt: Date.now(),
  };
}

/** Memasang kunci publik ke berkas ~/.ssh/authorized_keys pada remote server yang sedang terhubung. */
export async function installKeyToRemoteServer(
  connection: SessionChannels,
  publicKeyContent: string,
): Promise<{ success: boolean; message?: string }> {
  const cleanKey = publicKeyContent.trim().replace(/[\r\n]+/g, ' ');
  if (!cleanKey.startsWith('ssh-') && !cleanKey.startsWith('ecdsa-')) {
    throw new Error('Format kunci publik tidak valid (harus diawali ssh- atau ecdsa-).');
  }

  // Escape single quotes for bash
  const escaped = cleanKey.replace(/'/g, `'\\''`);

  // Pastikan folder ~/.ssh ada dengan izin 700, append key, beri izin 600, dan hapus duplikasi
  const remoteCommand = [
    'mkdir -p ~/.ssh',
    'chmod 700 ~/.ssh',
    `printf '%s\\n' '${escaped}' >> ~/.ssh/authorized_keys`,
    'chmod 600 ~/.ssh/authorized_keys',
    'sort -u ~/.ssh/authorized_keys -o ~/.ssh/authorized_keys 2>/dev/null || true',
  ].join(' && ');

  const res = await connection.exec(remoteCommand);
  if (res.code === 0) {
    return { success: true };
  }

  return {
    success: false,
    message: res.stderr.trim() || `Gagal memasang kunci (exit code ${res.code}).`,
  };
}
