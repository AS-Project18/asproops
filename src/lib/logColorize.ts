/**
 * Pewarnaan baris log polos (tanpa kode ANSI dari sumbernya) — level log,
 * timestamp, dan alamat IP masing-masing diberi warna lewat kode SGR yang
 * dipetakan ke palet THEME xterm yang sama dipakai terminal, supaya
 * tampilannya konsisten dengan warna bawaan aplikasi.
 */

const RESET = '\x1b[0m';
const STYLE = {
  levelError: '\x1b[1;91m',
  levelWarn: '\x1b[1;33m',
  levelInfo: '\x1b[36m',
  levelDebug: '\x1b[2;90m',
  timestamp: '\x1b[2m',
  ipv4: '\x1b[35m',
};

const TOKEN_RE = new RegExp(
  [
    String.raw`(?<levelError>\b(?:FATAL|CRITICAL|CRIT|ERROR)\b)`,
    String.raw`(?<levelWarn>\b(?:WARN|WARNING)\b)`,
    String.raw`(?<levelInfo>\b(?:INFO|NOTICE)\b)`,
    String.raw`(?<levelDebug>\b(?:DEBUG|TRACE)\b)`,
    // ISO 8601, mis. "2026-08-15T17:26:56.123Z" atau "2026-08-15 17:26:56".
    String.raw`(?<timestampIso>\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\b)`,
    // Gaya syslog, mis. "Aug 15 17:26:56".
    String.raw`(?<timestampSyslog>\b[A-Za-z]{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\b)`,
    String.raw`(?<ipv4>\b(?:\d{1,3}\.){3}\d{1,3}\b)`,
  ].join('|'),
  'gi',
);

export function colorizeLine(line: string): string {
  return line.replace(TOKEN_RE, (match, ...rest) => {
    const groups = rest[rest.length - 1] as Record<string, string | undefined>;
    const style =
      (groups.levelError && STYLE.levelError) ||
      (groups.levelWarn && STYLE.levelWarn) ||
      (groups.levelInfo && STYLE.levelInfo) ||
      (groups.levelDebug && STYLE.levelDebug) ||
      (groups.timestampIso && STYLE.timestamp) ||
      (groups.timestampSyslog && STYLE.timestamp) ||
      (groups.ipv4 && STYLE.ipv4);
    return style ? `${style}${match}${RESET}` : match;
  });
}
