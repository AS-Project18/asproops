import type { Terminal } from '@xterm/xterm';

/**
 * Mengekstrak seluruh baris teks dari active buffer xterm.js tanpa merusak
 * pilihan seleksi user saat ini.
 */
export function extractTerminalTranscript(term: Terminal): string {
  const buffer = term.buffer.active;
  const lines: string[] = [];
  for (let i = 0; i < buffer.length; i++) {
    const line = buffer.getLine(i);
    if (line) {
      lines.push(line.translateToString(true));
    }
  }

  // Hapus baris kosong di bagian paling akhir
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }

  return lines.join('\n');
}

/**
 * Format nama berkas default dengan stempel waktu:
 * e.g. "prod-web_2026-11-11_17-30-00.log"
 */
export function formatTranscriptFilename(prefix: string): string {
  const sanitized = (prefix || 'terminal').replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_');
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '-');
  return `${sanitized}_${dateStr}_${timeStr}.log`;
}
