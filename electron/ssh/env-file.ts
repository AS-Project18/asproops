import type { SessionChannels } from './connection-manager';
import type { EnvFileResult } from '../../src/shared/types';

/**
 * Baca/tulis berkas `.env` di root path sebuah Project — beda dari
 * `ProjectProfile.env` (variabel yang di-export sebelum langkah deploy di
 * deploy.ts), ini berkas SUNGGUHAN di server yang dibaca langsung oleh
 * aplikasi PHP (Laravel/CodeIgniter 4) saat runtime. Parsing/reserialisasi
 * baris dilakukan di renderer (murni transformasi teks, tidak butuh SSH) —
 * modul ini cuma mengangkut isi berkas apa adanya, supaya komentar/urutan
 * baris yang tidak disentuh tetap utuh saat disimpan ulang.
 */

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export async function readEnvFile(
  connection: SessionChannels,
  projectPath: string,
): Promise<EnvFileResult> {
  const command = [
    `cd -- ${shellQuote(projectPath)} || exit 9`,
    'test -f .env || exit 8',
    'cat -- .env',
  ].join('; ');

  const { stdout, stderr, code } = await connection.exec(command);
  if (code === 9) throw new Error('Path project tidak ditemukan di server.');
  if (code === 8) return { exists: false, content: '' };
  if (code !== 0) throw new Error(stderr.trim() || 'Gagal membaca .env di server.');
  return { exists: true, content: stdout };
}

export async function writeEnvFile(
  connection: SessionChannels,
  projectPath: string,
  content: string,
): Promise<void> {
  const b64 = Buffer.from(content, 'utf8').toString('base64');
  const command = `cd -- ${shellQuote(projectPath)} && printf '%s' ${shellQuote(b64)} | base64 -d > .env`;
  const { stderr, code } = await connection.exec(command);
  if (code !== 0) throw new Error(stderr.trim() || 'Gagal menyimpan .env ke server.');
}
