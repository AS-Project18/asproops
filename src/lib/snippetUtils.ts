/**
 * Mengekstrak nama variabel dinamis dengan pola {{variable}} dari string perintah.
 * Contoh: "docker logs -f {{service}} {{lines}}" -> ["service", "lines"]
 */
export function extractSnippetVariables(command: string): string[] {
  const matches = command.match(/\{\{([a-zA-Z0-9_-]+)\}\}/g);
  if (!matches) return [];
  const list = matches.map((m) => m.slice(2, -2).trim());
  return Array.from(new Set(list));
}

/**
 * Menggantikan token {{variable}} dengan nilai aktual yang diisi pengguna.
 */
export function interpolateSnippet(command: string, values: Record<string, string>): string {
  let result = command;
  for (const [key, val] of Object.entries(values)) {
    result = result.replaceAll(`{{${key}}}`, val);
  }
  return result;
}

/**
 * Mengirimkan perintah ke terminal aktif melalui event global `asproops:terminal-exec`.
 * @param command Teks perintah yang sudah diinterpolasi
 * @param enter True untuk langsung mengeksekusi dengan enter; False untuk hanya menempelkan ke baris prompt
 */
export function dispatchTerminalExec(command: string, enter = true): void {
  window.dispatchEvent(
    new CustomEvent('asproops:terminal-exec', {
      detail: { text: command, enter },
    }),
  );
}
