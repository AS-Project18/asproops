import type { ClientChannel } from 'ssh2';
import type { SessionChannels } from './connection-manager';

/**
 * Log login SSH milik SERVER (dicatat sshd sendiri), bukan log koneksi
 * ASProOps. Mencakup login dari klien mana pun (PuTTY, WinSCP, ASProOps di
 * PC lain, dst) — beda dari riwayat koneksi lokal yang hanya melihat apa
 * yang dibuka lewat app ini.
 *
 * Dua sumber dicoba sesuai distro:
 *   - `journalctl` (distro systemd modern — Ubuntu/Debian/RHEL terkini)
 *   - `/var/log/auth.log` (Debian/Ubuntu tanpa journal persisten) atau
 *     `/var/log/secure` (RHEL/CentOS/Fedora)
 *
 * Membaca log ini lazimnya butuh privilese (root, grup adm/systemd-journal,
 * atau sudo) — alur di bawah mencoba akses langsung dulu, lalu sudo tanpa
 * password, dan baru minta password ke pengguna kalau memang perlu.
 *
 * Dua mode pemakaian di atas target+akses yang sama:
 *   - resolveAuthLog / openAuthLogStream: stream live (`-f`/`-F`), dipakai
 *     tab Log Login mode "Live".
 *   - resolveAuthLogRange / runAuthLogRangeQuery: query sekali-jalan untuk
 *     rentang tanggal tertentu (mode histori — lihat log hari lain).
 */

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

interface AuthLogTarget {
  kind: 'journalctl' | 'file';
  /** Hanya terisi untuk kind === 'file'. */
  path?: string;
  /** Perintah murah untuk sekadar mengecek bisa dibaca atau tidak. */
  probeCommand: string;
  label: string;
}

const FILE_CANDIDATES = ['/var/log/auth.log', '/var/log/secure'];

async function detectTarget(connection: SessionChannels): Promise<AuthLogTarget> {
  const hasJournalctl = await connection.exec('command -v journalctl');
  if (hasJournalctl.code === 0) {
    return {
      kind: 'journalctl',
      probeCommand: 'journalctl -u ssh -u sshd --no-pager -q -n 1',
      label: 'journalctl (ssh/sshd)',
    };
  }

  for (const path of FILE_CANDIDATES) {
    const exists = await connection.exec(`test -f ${shellQuote(path)}`);
    if (exists.code === 0) {
      return {
        kind: 'file',
        path,
        probeCommand: `tail -n 1 -- ${shellQuote(path)}`,
        label: path,
      };
    }
  }

  throw new Error(
    'Tidak ditemukan journalctl maupun /var/log/auth.log atau /var/log/secure di server ini. ' +
      'Log login SSH mungkin disimpan di lokasi lain, atau logging autentikasi tidak aktif.',
  );
}

function buildFollowCommand(target: AuthLogTarget): string {
  return target.kind === 'journalctl'
    ? 'journalctl -u ssh -u sshd --no-pager -q -n 200 -f'
    : `tail -F -n 200 -- ${shellQuote(target.path!)}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Format yang diterima --since/--until journalctl: "YYYY-MM-DD HH:MM:SS". */
function journalctlTimestamp(ms: number): string {
  const d = new Date(ms);
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  );
}

const SYSLOG_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** syslog memakai padding SPASI (bukan nol) untuk tanggal satu digit, mis. "Aug  8". */
function syslogDayLabel(ms: number): string {
  const d = new Date(ms);
  const day = d.getDate();
  const dayStr = day < 10 ? ` ${day}` : `${day}`;
  return `${SYSLOG_MONTHS[d.getMonth()]} ${dayStr}`;
}

/**
 * journalctl punya --since/--until asli, presisi ke detik. Fallback berkas
 * (bukan systemd) tidak punya itu — jadi difilter lewat pola tanggal syslog
 * di awal baris ("Aug 14 ", "Aug  8 ", dst), satu alternasi per hari dalam
 * rentangnya. Catatan: hanya mencakup berkas log AKTIF (auth.log/secure),
 * bukan arsip hasil logrotate (auth.log.1, .2.gz, dst).
 */
function buildRangeCommand(target: AuthLogTarget, sinceMs: number, untilMs: number): string {
  if (target.kind === 'journalctl') {
    return (
      `journalctl -u ssh -u sshd --no-pager -q ` +
      `--since ${shellQuote(journalctlTimestamp(sinceMs))} --until ${shellQuote(journalctlTimestamp(untilMs))}`
    );
  }

  const days = new Set<string>();
  for (let t = sinceMs; t <= untilMs; t += 86_400_000) days.add(syslogDayLabel(t));
  days.add(syslogDayLabel(untilMs));
  const pattern = `^(${[...days].map((d) => d.replace(/\s+/g, '\\s+')).join('|')})\\s`;
  return `grep -E ${shellQuote(pattern)} -- ${shellQuote(target.path!)}`;
}

/** true kalau `sudo -n` gagal MURNI karena minta password — bukan sebab lain (mis. user bukan sudoer). */
function sudoNeedsPassword(output: string): boolean {
  return /password is required/i.test(output);
}

/**
 * Sama seperti SshConnection.exec, tapi memberi akses ke stdin channel —
 * dibutuhkan untuk mengalirkan password ke `sudo -S` tanpa pernah
 * menaruhnya di argumen perintah (yang akan kelihatan lewat `ps` orang lain
 * di server yang sama).
 */
async function execWithStdin(
  connection: SessionChannels,
  command: string,
  stdin: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  const stream = await connection.execStream(command);
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    stream.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    stream.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    stream.on('close', (code: number) => resolve({ stdout, stderr, code: code ?? 0 }));
    stream.on('error', reject);
    stream.write(stdin);
    stream.end();
  });
}

type AccessCheck =
  | { ok: true; prefix: string }
  | { ok: false; needsPassword: true }
  | { ok: false; needsPassword: false; message: string };

/** Coba akses langsung, lalu `sudo -n` (jalan kalau NOPASSWD sudah dikonfigurasi). */
async function checkAccess(connection: SessionChannels, target: AuthLogTarget): Promise<AccessCheck> {
  const direct = await connection.exec(target.probeCommand);
  if (direct.code === 0) return { ok: true, prefix: '' };

  const viaSudo = await connection.exec(`sudo -n ${target.probeCommand} 2>&1`);
  if (viaSudo.code === 0) return { ok: true, prefix: 'sudo -n --' };

  if (sudoNeedsPassword(viaSudo.stdout)) return { ok: false, needsPassword: true };

  return {
    ok: false,
    needsPassword: false,
    message:
      `Tidak punya akses baca ke ${target.label}, dan sudo tidak tersedia untuk user ini. ` +
      'Login dengan user yang jadi anggota grup adm/systemd-journal, atau minta admin server ' +
      'mengizinkan sudo untuk user ini.',
  };
}

type CommandResolution =
  | { ok: true; command: string; label: string }
  | { ok: false; needsPassword: true; command: string; label: string }
  | { ok: false; needsPassword: false; message: string };

function applyAccess(access: AccessCheck, bareCommand: string, label: string): CommandResolution {
  if (access.ok) {
    return { ok: true, command: access.prefix ? `${access.prefix} ${bareCommand}` : bareCommand, label };
  }
  if (access.needsPassword) return { ok: false, needsPassword: true, command: bareCommand, label };
  return { ok: false, needsPassword: false, message: access.message };
}

/**
 * Coba buka log tanpa password: akses langsung, lalu `sudo -n`. Kalau
 * ternyata butuh password, `command` yang dikembalikan adalah perintah
 * MENTAH (tanpa prefix sudo) — pemanggil membungkusnya dengan `sudo -S`
 * sendiri setelah password didapat.
 */
export async function resolveAuthLog(connection: SessionChannels): Promise<CommandResolution> {
  const target = await detectTarget(connection);
  const access = await checkAccess(connection, target);
  return applyAccess(access, buildFollowCommand(target), target.label);
}

/** Sama seperti resolveAuthLog, tapi untuk query histori satu rentang tanggal (bukan stream live). */
export async function resolveAuthLogRange(
  connection: SessionChannels,
  sinceMs: number,
  untilMs: number,
): Promise<CommandResolution> {
  const target = await detectTarget(connection);
  const access = await checkAccess(connection, target);
  return applyAccess(access, buildRangeCommand(target, sinceMs, untilMs), target.label);
}

/**
 * Verifikasi password sudo lewat perintah murah SEBELUM dipakai membuka
 * stream `-f` yang hidup lama — supaya password salah langsung dilaporkan
 * jelas ("password salah"), bukan diam-diam bikin stream yang mati sendiri
 * beberapa saat setelah dibuka.
 */
export async function verifySudoPassword(
  connection: SessionChannels,
  password: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const result = await execWithStdin(connection, 'sudo -S -p \'\' -k -- true', `${password}\n`);
  if (result.code === 0) return { ok: true };
  return { ok: false, message: 'Password salah, atau user ini tidak diizinkan sudo.' };
}

/**
 * Buka stream live (`journalctl -f` / `tail -F`) untuk perintah yang sudah
 * ditentukan resolveAuthLog. `password` hanya diisi kalau perintahnya perlu
 * dibungkus `sudo -S` — dialirkan lewat stdin channel, tidak pernah lewat
 * argumen command.
 */
export async function openAuthLogStream(
  connection: SessionChannels,
  followCommand: string,
  password?: string,
): Promise<ClientChannel> {
  if (!password) return connection.execStream(followCommand);

  const stream = await connection.execStream(`sudo -S -p '' -- ${followCommand}`);
  // journalctl -f / tail -F tidak pernah baca stdin lagi setelah ini — stdin
  // ditutup supaya channel-nya bersih, bukan menggantung terbuka tanpa guna.
  stream.write(`${password}\n`);
  stream.end();
  return stream;
}

/**
 * Jalankan query histori (perintah dari resolveAuthLogRange) sekali sampai
 * selesai — beda dari openAuthLogStream yang membuka stream hidup terus.
 */
export async function runAuthLogRangeQuery(
  connection: SessionChannels,
  command: string,
  password?: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  if (!password) return connection.exec(command);
  return execWithStdin(connection, `sudo -S -p '' -- ${command}`, `${password}\n`);
}
