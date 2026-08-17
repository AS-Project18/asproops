/** Pemformatan angka yang dipakai di panel monitor dan file browser. */

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    BYTE_UNITS.length - 1,
  );
  const value = bytes / 1024 ** exponent;
  // Satuan byte tidak perlu desimal; angka besar cukup satu desimal.
  return `${value.toFixed(exponent === 0 ? 0 : decimals)} ${BYTE_UNITS[exponent]}`;
}

export function formatRate(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days} hari ${hours} jam`;
  if (hours > 0) return `${hours} jam ${minutes} menit`;
  return `${minutes} menit`;
}

export function formatDate(timestamp: number, locale = 'id-ID'): string {
  return new Date(timestamp).toLocaleString(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Tanggal+jam ringkas TANPA tahun, mis. "17 Agu, 23:54" — dipakai di daftar
 * yang sempit (sidebar) dan butuh tanggal (bukan cuma jam) supaya entri
 * lintas hari tidak ambigu, tapi tidak ada ruang untuk format selengkap
 * formatDate().
 */
export function formatLogTimestamp(timestamp: number, locale = 'id-ID'): string {
  return new Date(timestamp).toLocaleString(locale, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Durasi ringkas "1h 20m" / "11m" / "45s" — dipakai untuk lama sesi login di Log Login. */
export function formatDurationShort(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

/** Warna ambang: hijau di bawah 70%, kuning 70–89%, merah 90% ke atas. */
export function thresholdColor(percent: number): string {
  if (percent >= 90) return '#f07178';
  if (percent >= 70) return '#ffcb6b';
  return '#6ee7b7';
}
