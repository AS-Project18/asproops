import type { SessionChannels } from './connection-manager';

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Berapa hari ke belakang file di folder log dianggap masih relevan untuk dideteksi. */
const RECENT_DAYS = 30;
/** Berapa banyak file terbaru maksimal yang dikembalikan, supaya tidak membanjiri daftar log project. */
const MAX_RESULTS = 10;

/**
 * Deteksi log framework PHP umum (Laravel di `storage/logs/`, CodeIgniter 4
 * di `writable/logs/`) relatif ke path project. Nama filenya sengaja TIDAK
 * dibatasi pola tertentu (mis. `log-YYYY-MM-DD.php`) — banyak setup pakai
 * nama custom (channel log kustom di Laravel, atau `Config\Logger` yang
 * diubah di CI4) — jadi yang dijadikan filter cuma "file biasa yang
 * dimodifikasi RECENT_DAYS hari terakhir di salah satu folder itu", diambil
 * yang paling baru duluan. `index.html`/`.gitignore` dikecualikan karena itu
 * placeholder bawaan framework, bukan berkas log sungguhan.
 *
 * Hasilnya SENGAJA path absolut (bukan relatif ke project path) — `find`
 * diberi target absolut langsung, tanpa `cd` dulu, karena `log:open` (tail
 * -F) dijalankan dari direktori home SSH, bukan dari path project. Path
 * relatif di sini akan membuat tail menunggu file yang salah lokasi, isinya
 * kelihatan kosong terus walau file aslinya ada.
 */
export async function detectFrameworkLogs(
  connection: SessionChannels,
  projectPath: string,
): Promise<string[]> {
  const quotedPath = shellQuote(projectPath);
  const command = [
    `test -d ${quotedPath} || exit 9`,
    `find ${quotedPath}/storage/logs ${quotedPath}/writable/logs -maxdepth 1 -type f ! -name index.html ! -name .gitignore -mtime -${RECENT_DAYS} -printf '%T@ %p\\n' 2>/dev/null | sort -rn | head -${MAX_RESULTS} | cut -d' ' -f2-`,
  ].join('; ');

  const { stdout, code } = await connection.exec(command);
  if (code === 9) throw new Error('Path project tidak ditemukan di server.');

  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}
