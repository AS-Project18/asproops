import type { SessionChannels } from './connection-manager';
import type { CronJob } from '../../src/shared/types';

/**
 * Cron job manager — baca/tulis crontab milik pengguna yang sedang login
 * (BUKAN root/pengguna lain: `crontab -l`/`crontab -` tanpa `-u` selalu
 * beroperasi atas nama pengguna SSH yang sedang aktif, konsisten dengan
 * git.ts/deploy.ts yang juga tidak pernah mencoba sudo ke user lain).
 *
 * Setiap tulis (create/update/remove) MENULIS ULANG SELURUH crontab lewat
 * `crontab -`, bukan menyunting sebagian — itu satu-satunya cara resmi
 * mengubah crontab tanpa editor interaktif. `index` yang dipakai UI untuk
 * menargetkan satu baris adalah posisinya di larik baris mentah hasil
 * list() TERAKHIR; ada risiko kecil race kalau crontab berubah dari luar
 * ASProOps di antara list() dan write berikutnya, sama seperti risiko yang
 * sudah diterima fitur lain (mis. rollback berbasis commit hash).
 */

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** `@reboot`/`@daily`/... ATAU 5 field whitespace-separated, diikuti perintah. */
const SCHEDULE_RE = /^(@\w+|(?:\S+\s+){4}\S+)\s+(.+)$/;

function isEnvAssignment(line: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(line);
}

function parseCrontab(text: string): { lines: string[]; jobs: CronJob[] } {
  const lines = text.length > 0 ? text.replace(/\n+$/, '').split('\n') : [];
  const jobs: CronJob[] = [];

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || isEnvAssignment(trimmed)) return;

    const disabled = trimmed.startsWith('#');
    const body = disabled ? trimmed.slice(1).trim() : trimmed;
    // Baris ganda-komentar (mis. header section "## Deploy jobs") bukan job
    // yang dinonaktifkan, cuma komentar biasa — lewati.
    if (body.startsWith('#')) return;

    const match = body.match(SCHEDULE_RE);
    if (!match) return;

    jobs.push({ index, schedule: match[1], command: match[2], enabled: !disabled });
  });

  return { lines, jobs };
}

function serializeJob(job: Pick<CronJob, 'schedule' | 'command' | 'enabled'>): string {
  const line = `${job.schedule} ${job.command}`;
  return job.enabled ? line : `# ${line}`;
}

async function readCrontab(connection: SessionChannels): Promise<string> {
  const { stdout, stderr, code } = await connection.exec('crontab -l 2>&1');
  if (code === 0) return stdout;
  if (/no crontab for/i.test(stderr || stdout)) return '';
  throw new Error(
    (stderr || stdout).trim() || 'crontab gagal dijalankan. Pastikan cron terpasang di server ini.',
  );
}

async function writeCrontab(connection: SessionChannels, lines: string[]): Promise<void> {
  const content = lines.length > 0 ? lines.join('\n') + '\n' : '';
  const b64 = Buffer.from(content, 'utf8').toString('base64');
  const command = `printf '%s' ${shellQuote(b64)} | base64 -d | crontab -`;
  const { stdout, stderr, code } = await connection.exec(command);
  if (code !== 0) {
    throw new Error((stderr || stdout).trim() || 'Gagal menyimpan crontab.');
  }
}

export async function listCronJobs(connection: SessionChannels): Promise<CronJob[]> {
  const text = await readCrontab(connection);
  return parseCrontab(text).jobs;
}

export async function createCronJob(
  connection: SessionChannels,
  input: { schedule: string; command: string },
): Promise<void> {
  const text = await readCrontab(connection);
  const { lines } = parseCrontab(text);
  lines.push(serializeJob({ schedule: input.schedule, command: input.command, enabled: true }));
  await writeCrontab(connection, lines);
}

export async function updateCronJob(
  connection: SessionChannels,
  index: number,
  input: { schedule: string; command: string; enabled: boolean },
): Promise<void> {
  const text = await readCrontab(connection);
  const { lines } = parseCrontab(text);
  if (index < 0 || index >= lines.length) throw new Error('Cron job tidak ditemukan (crontab sudah berubah).');
  lines[index] = serializeJob(input);
  await writeCrontab(connection, lines);
}

export async function removeCronJob(connection: SessionChannels, index: number): Promise<void> {
  const text = await readCrontab(connection);
  const { lines } = parseCrontab(text);
  if (index < 0 || index >= lines.length) throw new Error('Cron job tidak ditemukan (crontab sudah berubah).');
  lines.splice(index, 1);
  await writeCrontab(connection, lines);
}
