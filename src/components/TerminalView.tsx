import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import { useTerminalPrefs } from '../terminalPrefs';
import { stripAnsi } from '../lib/ansi';
import { ContextMenu, ContextMenuItem, type ContextMenuPosition } from './ContextMenu';
import { useI18n } from '../i18n';

function defaultFontFamily(): string {
  return (
    getComputedStyle(document.documentElement).getPropertyValue('--font-mono') ||
    'Consolas, monospace'
  );
}

interface TerminalViewProps {
  sessionId: string;
  /**
   * Terminal yang tidak aktif tetap terpasang, hanya disembunyikan — kalau
   * dilepas, channel SSH ikut tertutup dan proses yang sedang berjalan mati.
   * Prop ini menandai kapan perlu mengukur ulang dan mengambil fokus.
   */
  active: boolean;
  onRequestNewTab?: () => void;
  onRequestCloseTab?: () => void;
  onExit?: () => void;
}

const THEME = {
  background: '#020307',
  foreground: '#d9d1de',
  cursor: '#ff9700',
  cursorAccent: '#020307',
  selectionBackground: '#7b2aa955',
  black: '#08050b',
  red: '#ff5a68',
  green: '#58e879',
  yellow: '#ffb52e',
  blue: '#8f83ff',
  magenta: '#c05cff',
  cyan: '#6bd8e8',
  white: '#e9e2ed',
  brightBlack: '#716878',
  brightRed: '#ff7b86',
  brightGreen: '#7cf197',
  brightYellow: '#ffc85f',
  brightBlue: '#aaa2ff',
  brightMagenta: '#d783ff',
  brightCyan: '#8be7f3',
  brightWhite: '#ffffff',
};

/**
 * Deteksi direktori kerja dari prompt Linux umum:
 *   user@host:/var/www$
 *   user@host:~$
 *   root@host:/etc#
 *
 * Ini tidak memodifikasi shell remote. Bila prompt kustom tidak memuat path,
 * File Browser tetap bisa dipakai manual.
 */
function detectPromptCwd(buffer: string): string | null {
  const clean = stripAnsi(buffer);
  const lines = clean.split('\n');
  for (let index = lines.length - 1; index >= Math.max(0, lines.length - 4); index -= 1) {
    const line = lines[index].trimEnd();
    const match = line.match(/(?:^|\s)[\w.-]+@[\w.-]+:([~\/][^$#\n]*?)[#$]\s*$/);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

export function TerminalView({
  sessionId,
  active,
  onRequestNewTab,
  onRequestCloseTab,
  onExit,
}: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const terminalIdRef = useRef<string | null>(null);
  const outputTailRef = useRef('');
  const lastCwdRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuPosition | null>(null);

  const { t } = useI18n();
  const { prefs } = useTerminalPrefs();

  // Callback disimpan di ref supaya handler papan ketik tidak perlu dipasang
  // ulang setiap kali induk render.
  const newTabRef = useRef(onRequestNewTab);
  const closeTabRef = useRef(onRequestCloseTab);
  const exitRef = useRef(onExit);
  // Dibaca sekali saat mount (lihat komentar effect utama di bawah) — nilai
  // TERKINI dipakai lewat effect terpisah supaya tidak perlu buka-tutup
  // shell ulang tiap kali preferensi berubah.
  const prefsRef = useRef(prefs);

  newTabRef.current = onRequestNewTab;
  closeTabRef.current = onRequestCloseTab;
  exitRef.current = onExit;
  prefsRef.current = prefs;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      fontFamily: prefsRef.current.fontFamily || defaultFontFamily(),
      fontSize: prefsRef.current.fontSize,
      lineHeight: 1.25,
      cursorBlink: prefsRef.current.cursorBlink,
      cursorStyle: prefsRef.current.cursorStyle,
      scrollback: prefsRef.current.scrollback,
      allowProposedApi: true,
      theme: THEME,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.loadAddon(new SearchAddon());

    const unicode = new Unicode11Addon();
    term.loadAddon(unicode);
    term.unicode.activeVersion = '11';

    // Pintasan tab ditangani sebelum xterm; kalau tidak, Ctrl+Shift+T akan
    // dikirim ke shell sebagai karakter kontrol.
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown' || !event.ctrlKey || !event.shiftKey) return true;
      // event.repeat: browser mengirim keydown berulang selama tombol
      // ditahan. Tanpa penjagaan ini, menahan Ctrl+Shift+V sedikit lebih
      // lama menempel isi clipboard berkali-kali ke pty.
      if (event.repeat) return false;
      const key = event.key.toLowerCase();
      if (key === 't') {
        newTabRef.current?.();
        return false;
      }
      if (key === 'w') {
        closeTabRef.current?.();
        return false;
      }
      // Ctrl+Shift+C (bukan Ctrl+C polos, yang dipakai shell untuk SIGINT).
      if (key === 'c') {
        event.preventDefault();
        const selection = term.getSelection();
        if (selection) window.ssh.clipboard.writeText(selection);
        return false;
      }
      if (key === 'v') {
        // Mengembalikan false di sini cuma memberi tahu xterm sendiri untuk
        // tidak memprosesnya — TIDAK memanggil preventDefault() pada event
        // native. Tanpa ini, Chromium tetap menjalankan aksi bawaannya
        // untuk Ctrl+Shift+V ("paste as plain text"), memicu event 'paste'
        // asli pada textarea xterm yang DITANGKAP LAGI oleh listener paste
        // internal xterm sendiri — clipboard ter-tempel dua kali: sekali
        // dari kita, sekali dari xterm merespons paste browser itu. Ini
        // sudah ada sejak shortcut ini dibuat, bukan regresi baru.
        event.preventDefault();
        const text = window.ssh.clipboard.readText();
        if (text && terminalIdRef.current) term.paste(text);
        return false;
      }
      return true;
    });

    termRef.current = term;
    fitRef.current = fit;

    let disposed = false;
    let opened = false;
    let frame = 0;
    let observer: ResizeObserver | null = null;
    const unsubscribers: Array<() => void> = [];

    const initialize = () => {
      if (disposed) return;

      // xterm mengukur sel karakter langsung dari DOM saat open(). Container
      // yang belum masuk layout (mis. baru saja dipasang di tab yang baru
      // aktif) diukur sebagai nol, dan proses internal xterm yang berjalan
      // lewat setTimeout crash beberapa saat kemudian ("Cannot read
      // properties of undefined (reading 'dimensions')") — sama seperti
      // yang sudah ditangani di LocalTerminalView.
      if (container.clientWidth < 20 || container.clientHeight < 20) {
        frame = requestAnimationFrame(initialize);
        return;
      }

      opened = true;
      term.open(container);

      // Tunggu satu frame lagi setelah open agar renderer xterm selesai
      // mengukur font/canvas sebelum FitAddon dipanggil. Shell baru dibuka
      // SETELAH fit ini selesai (bukan paralel) — kalau tidak, term.cols/rows
      // masih nilai default xterm (80x24) saat window.ssh.shell.open()
      // membacanya, jadi pty-req awal ke server terkirim dengan ukuran
      // salah dan proses di dalamnya (mis. Claude Code CLI, `ls -la` di
      // server) merender seolah terminalnya 80x24 sampai ada resize nyata.
      requestAnimationFrame(() => {
        if (disposed) return;
        if (container.clientWidth > 0 && container.clientHeight > 0) {
          try {
            fit.fit();
          } catch {
            // ResizeObserver akan mencoba lagi ketika layout stabil.
          }
        }

        void (async () => {
          try {
            const id = await window.ssh.shell.open(sessionId, term.cols, term.rows);
            console.debug('[ASProOps] shell opened', { sessionId, terminalId: id });
            if (disposed) {
              window.ssh.shell.close(id);
              return;
            }
            terminalIdRef.current = id;

            unsubscribers.push(
              window.ssh.shell.onData(({ terminalId: source, data }) => {
                if (source !== id) return;

                term.write(data);

                outputTailRef.current = (outputTailRef.current + data).slice(-4096);
                const cwd = detectPromptCwd(outputTailRef.current);
                if (cwd && cwd !== lastCwdRef.current) {
                  lastCwdRef.current = cwd;
                  window.dispatchEvent(
                    new CustomEvent('asproops:terminal-cwd', {
                      detail: { sessionId, cwd },
                    }),
                  );
                }
              }),
              window.ssh.shell.onClose(({ terminalId: source }) => {
                if (source !== id) return;
                term.write('\r\n\x1b[33mKoneksi shell ditutup.\x1b[0m\r\n');
                exitRef.current?.();
              }),
            );

            term.onData((data) => window.ssh.shell.write(id, data));
          } catch (err) {
            setError((err as Error).message);
          }
        })();
      });

      observer = new ResizeObserver(() => {
        // Lebar nol berarti terminal sedang disembunyikan. Mengukur ulang
        // saat itu akan menyetel ukurannya ke 1x1 dan merusak tampilan
        // saat muncul.
        if (container.clientWidth === 0) return;
        fit.fit();
        if (terminalIdRef.current) {
          window.ssh.shell.resize(terminalIdRef.current, term.cols, term.rows);
        }
      });
      observer.observe(container);
    };

    frame = requestAnimationFrame(initialize);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      for (const unsubscribe of unsubscribers) unsubscribe();
      if (terminalIdRef.current) {
        console.debug('[ASProOps] shell closing', {
          sessionId,
          terminalId: terminalIdRef.current,
        });
        window.ssh.shell.close(terminalIdRef.current);
      }
      // term.dispose() sebelum open() sungguh terpasang bisa memicu ulang
      // internal yang sama dengan bug di atas — lewati kalau belum dibuka.
      if (opened) term.dispose();
      termRef.current = null;
      fitRef.current = null;
      terminalIdRef.current = null;
      outputTailRef.current = '';
      lastCwdRef.current = null;
    };
  // Sangat penting: lifecycle shell hanya mengikuti sessionId.
  // Callback UI disimpan di ref agar render ulang parent (mis. berpindah
  // File Browser ↔ Monitoring) TIDAK menutup dan membuka shell baru.
  }, [sessionId]);

  // Terapkan perubahan preferensi ke terminal yang sudah terbuka, tanpa
  // menutup shell-nya (beda effect dari effect mount di atas).
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontFamily = prefs.fontFamily || defaultFontFamily();
    term.options.fontSize = prefs.fontSize;
    term.options.cursorBlink = prefs.cursorBlink;
    term.options.cursorStyle = prefs.cursorStyle;
    term.options.scrollback = prefs.scrollback;
    try {
      fitRef.current?.fit();
    } catch {
      /* container mungkin belum terlihat; ResizeObserver akan menyusul */
    }
  }, [prefs]);

  useEffect(() => {
    if (!active) return;
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit) return;

    // Ukuran container baru benar setelah frame berikutnya digambar.
    const frame = requestAnimationFrame(() => {
      fit.fit();
      if (terminalIdRef.current) {
        window.ssh.shell.resize(terminalIdRef.current, term.cols, term.rows);
      }
      term.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [active]);

  // Klik-kanan biasa (tanpa Shift) langsung copy (kalau ada seleksi) atau
  // paste (kalau tidak ada) — meniru perilaku terminal Windows pada umumnya
  // (PuTTY, Windows Terminal). Shift+klik-kanan tetap membuka menu Copy/Paste.
  //
  // Dilewati sepenuhnya kalau program di dalam terminal sudah mengaktifkan
  // mouse tracking (mis. Claude Code CLI, mode "any"): xterm.js SUDAH
  // mengirim laporan klik itu ke program lewat PTY secara independen dari
  // event contextmenu ini (lewat mousedown/mouseup internalnya sendiri).
  // Kalau kita TETAP menambahkan paste kita sendiri di atasnya, dan program
  // itu juga punya aksi klik-kanan sendiri (banyak TUI berbasis mouse
  // tracking mengimplementasikan paste-lewat-klik-kanan), hasilnya teks yang
  // di-paste masuk dua kali — satu dari kita, satu dari program itu sendiri.
  // Begitu mouse tracking aktif, biarkan program yang menentukan sepenuhnya
  // apa arti klik itu, sama seperti perilaku terminal emulator pada umumnya.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleContextMenu = (event: MouseEvent) => {
      const term = termRef.current;
      if (term && term.modes.mouseTrackingMode !== 'none') return;

      event.preventDefault();
      event.stopPropagation();
      if (!event.shiftKey) {
        if (term?.hasSelection()) {
          const selection = term.getSelection();
          if (selection) window.ssh.clipboard.writeText(selection);
          term.clearSelection();
        } else {
          const text = window.ssh.clipboard.readText();
          if (text && terminalIdRef.current) term?.paste(text);
        }
        term?.focus();
        return;
      }
      setContextMenu({ x: event.clientX, y: event.clientY });
    };

    container.addEventListener('contextmenu', handleContextMenu, true);
    return () => container.removeEventListener('contextmenu', handleContextMenu, true);
  }, []);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center bg-abyss p-8 text-center">
        <div>
          <p className="text-sm text-coral">Shell tidak bisa dibuka.</p>
          <p className="mt-2 text-xs text-muted">{error}</p>
        </div>
      </div>
    );
  }

  // Fokus dikembalikan ke terminal setelah aksi clipboard supaya pengguna
  // bisa langsung mengetik tanpa perlu klik ulang ke area terminal.
  const copySelection = () => {
    const selection = termRef.current?.getSelection();
    if (selection) window.ssh.clipboard.writeText(selection);
    setContextMenu(null);
    termRef.current?.focus();
  };

  const pasteClipboard = () => {
    const text = window.ssh.clipboard.readText();
    if (text && terminalIdRef.current) termRef.current?.paste(text);
    setContextMenu(null);
    termRef.current?.focus();
  };

  const closeContextMenu = () => {
    setContextMenu(null);
    termRef.current?.focus();
  };

  return (
    <>
      <div ref={containerRef} className="aspro-xterm h-full w-full bg-abyss p-2" />
      {contextMenu && (
        <ContextMenu position={contextMenu} onClose={closeContextMenu}>
          <ContextMenuItem onClick={copySelection} disabled={!termRef.current?.hasSelection()}>
            {t('menu.copy')}
          </ContextMenuItem>
          <ContextMenuItem onClick={pasteClipboard}>{t('menu.paste')}</ContextMenuItem>
        </ContextMenu>
      )}
    </>
  );
}
