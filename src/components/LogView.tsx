import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import { useTerminalPrefs } from '../terminalPrefs';
import { stripAnsi } from '../lib/ansi';
import { useI18n } from '../i18n';

/**
 * Viewer log live — `tail -F` yang streaming ke xterm read-only.
 *
 * Pakai xterm (bukan <pre> biasa) supaya ANSI color dari log berwarna ikut
 * dirender, dan supaya scrollback besar tetap ringan — persis alasan yang
 * sama kenapa TerminalView pakai xterm. Beda utamanya: tidak ada input yang
 * dikirim balik ke server (disableStdin), dan tidak ada negosiasi ukuran
 * PTY karena `tail -F` bukan proses interaktif.
 */

/** Baris yang disimpan di memori renderer untuk keperluan filter — dibatasi supaya sesi log yang dibiarkan lama tidak membengkak. */
const MAX_BUFFERED_LINES = 5000;

const SEARCH_DECORATIONS = {
  matchBackground: '#3c1b4b',
  matchBorder: '#8742a4',
  matchOverviewRuler: '#8742a4',
  activeMatchBackground: '#c87324',
  activeMatchBorder: '#ff9700',
  activeMatchColorOverviewRuler: '#ff9700',
};

function defaultFontFamily(): string {
  return (
    getComputedStyle(document.documentElement).getPropertyValue('--font-mono') ||
    'Consolas, monospace'
  );
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

interface LogViewProps {
  sessionId: string;
  path: string;
  active: boolean;
  onExit?: () => void;
}

export function LogView({ sessionId, path, active, onExit }: LogViewProps) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const tailIdRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Baris lengkap (sudah diakhiri \n) yang sudah diterima, dipakai untuk
  // menyusun ulang tampilan saat filter berubah. `partial` menyimpan sisa
  // baris yang belum lengkap karena chunk stream terpotong di tengah baris.
  const linesRef = useRef<string[]>([]);
  const partialRef = useRef('');
  const filterRef = useRef('');

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [matchInfo, setMatchInfo] = useState<{ index: number; count: number } | null>(null);
  const [copied, setCopied] = useState(false);

  const { prefs } = useTerminalPrefs();
  const exitRef = useRef(onExit);
  const prefsRef = useRef(prefs);
  exitRef.current = onExit;
  prefsRef.current = prefs;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      fontFamily: prefsRef.current.fontFamily || defaultFontFamily(),
      fontSize: prefsRef.current.fontSize,
      lineHeight: 1.25,
      cursorBlink: false,
      scrollback: prefsRef.current.scrollback,
      allowProposedApi: true,
      disableStdin: true,
      // `tail -F` mengalir lewat exec channel biasa (bukan PTY), jadi
      // barisnya diakhiri "\n" polos tanpa "\r" — tanpa ini xterm menggeser
      // tiap baris makin ke kanan alih-alih kembali ke kolom 0 (efek tangga).
      convertEol: true,
      theme: THEME,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());

    const searchAddon = new SearchAddon();
    term.loadAddon(searchAddon);
    searchAddonRef.current = searchAddon;
    const searchResultsListener = searchAddon.onDidChangeResults(({ resultIndex, resultCount }) => {
      setMatchInfo({ index: resultIndex, count: resultCount });
    });

    // Ctrl+Shift+C (bukan Ctrl+C polos — tidak relevan di sini karena
    // disableStdin, tapi tetap konsisten dengan pintasan copy di terminal).
    term.attachCustomKeyEventHandler((event) => {
      if (
        event.type === 'keydown' &&
        event.ctrlKey &&
        event.shiftKey &&
        event.key.toLowerCase() === 'c'
      ) {
        const selection = term.getSelection();
        if (selection) void navigator.clipboard.writeText(selection);
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

    const ingest = (chunk: string) => {
      const combined = partialRef.current + chunk;
      const parts = combined.split('\n');
      partialRef.current = parts.pop() ?? '';

      if (parts.length > 0) {
        linesRef.current.push(...parts);
        const overflow = linesRef.current.length - MAX_BUFFERED_LINES;
        if (overflow > 0) linesRef.current.splice(0, overflow);
      }

      if (!filterRef.current) {
        term.write(chunk);
        return;
      }

      if (parts.length === 0) return;
      const query = filterRef.current.toLowerCase();
      const matched = parts.filter((line) => stripAnsi(line).toLowerCase().includes(query));
      if (matched.length > 0) term.write(matched.join('\n') + '\n');
    };

    const initialize = () => {
      if (disposed) return;

      // Sama seperti TerminalView: container yang belum masuk layout diukur
      // sebagai nol, dan xterm crash beberapa saat kemudian kalau dipaksa
      // open() lebih awal.
      if (container.clientWidth < 20 || container.clientHeight < 20) {
        frame = requestAnimationFrame(initialize);
        return;
      }

      opened = true;
      term.open(container);

      requestAnimationFrame(() => {
        if (!disposed && container.clientWidth > 0 && container.clientHeight > 0) {
          try {
            fit.fit();
          } catch {
            // ResizeObserver akan mencoba lagi ketika layout stabil.
          }
        }
      });

      void (async () => {
        try {
          const tailId = await window.ssh.log.open(sessionId, path);
          if (disposed) {
            window.ssh.log.close(tailId);
            return;
          }
          tailIdRef.current = tailId;

          unsubscribers.push(
            window.ssh.log.onData(({ tailId: source, data }) => {
              if (source !== tailId) return;
              ingest(data);
            }),
            window.ssh.log.onClose(({ tailId: source }) => {
              if (source !== tailId) return;
              term.write('\r\n\x1b[33mLog stream ditutup.\x1b[0m\r\n');
              exitRef.current?.();
            }),
          );
        } catch (err) {
          setError((err as Error).message);
        }
      })();

      observer = new ResizeObserver(() => {
        if (container.clientWidth === 0) return;
        fit.fit();
      });
      observer.observe(container);
    };

    frame = requestAnimationFrame(initialize);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      searchResultsListener.dispose();
      for (const unsubscribe of unsubscribers) unsubscribe();
      if (tailIdRef.current) window.ssh.log.close(tailIdRef.current);
      if (opened) term.dispose();
      termRef.current = null;
      fitRef.current = null;
      searchAddonRef.current = null;
      tailIdRef.current = null;
      linesRef.current = [];
      partialRef.current = '';
    };
  // sessionId+path saja sebagai dependency: buka tutup stream ulang cuma
  // kalau target log-nya sungguh berganti, bukan tiap render ulang parent.
  }, [sessionId, path]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontFamily = prefs.fontFamily || defaultFontFamily();
    term.options.fontSize = prefs.fontSize;
    term.options.scrollback = prefs.scrollback;
    try {
      fitRef.current?.fit();
    } catch {
      /* container mungkin belum terlihat; ResizeObserver akan menyusul */
    }
  }, [prefs]);

  useEffect(() => {
    if (!active) return;
    const fit = fitRef.current;
    if (!fit) return;
    const frame = requestAnimationFrame(() => fit.fit());
    return () => cancelAnimationFrame(frame);
  }, [active]);

  // Cari-seiring-mengetik, sama seperti find bar aplikasi lain. Enter/tombol
  // ↑↓ dipakai untuk lompat non-inkremental ke hasil sebelum/berikutnya.
  useEffect(() => {
    const addon = searchAddonRef.current;
    if (!addon) return;
    if (!search) {
      addon.clearDecorations();
      setMatchInfo(null);
      return;
    }
    addon.findNext(search, { caseSensitive: false, incremental: true, decorations: SEARCH_DECORATIONS });
  }, [search]);

  // Susun ulang buffer setiap filter berubah — didebounce ringan supaya
  // mengetik cepat tidak memicu clear+rewrite ribuan baris tiap huruf.
  useEffect(() => {
    const handle = setTimeout(() => {
      filterRef.current = filter;
      const term = termRef.current;
      if (!term) return;

      term.clear();
      const query = filter.toLowerCase();
      const rendered = filter
        ? linesRef.current.filter((line) => stripAnsi(line).toLowerCase().includes(query))
        : linesRef.current;
      if (rendered.length > 0) term.write(rendered.join('\n') + '\n');
      if (!filter && partialRef.current) term.write(partialRef.current);
    }, 200);
    return () => clearTimeout(handle);
  }, [filter]);

  const findNext = () => {
    if (!search) return;
    searchAddonRef.current?.findNext(search, { caseSensitive: false, decorations: SEARCH_DECORATIONS });
  };

  const findPrev = () => {
    if (!search) return;
    searchAddonRef.current?.findPrevious(search, {
      caseSensitive: false,
      decorations: SEARCH_DECORATIONS,
    });
  };

  const copyAll = () => {
    const query = filter.toLowerCase();
    const source = filter
      ? linesRef.current.filter((line) => stripAnsi(line).toLowerCase().includes(query))
      : linesRef.current;
    const text = source.map(stripAnsi).join('\n');
    if (!text) return;
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  const clearScreen = () => {
    linesRef.current = [];
    partialRef.current = '';
    termRef.current?.clear();
  };

  if (error) {
    return (
      <div className="flex h-full items-center justify-center bg-abyss p-8 text-center">
        <div>
          <p className="text-sm text-coral">Log tidak bisa dibuka.</p>
          <p className="mt-2 text-xs text-muted">{error}</p>
        </div>
      </div>
    );
  }

  const matchLabel = matchInfo ? (matchInfo.count > 0 ? `${matchInfo.index + 1}/${matchInfo.count}` : '0/0') : '';

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-panel/70 px-2 py-1.5">
        <div className="aspro-search compact min-w-0 flex-1">
          <span>⌕</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              if (e.shiftKey) findPrev();
              else findNext();
            }}
            placeholder={t('log.searchPlaceholder')}
            aria-label={t('log.searchPlaceholder')}
          />
        </div>
        <span className="w-10 shrink-0 text-center font-mono text-[10px] tabular-nums text-faint">
          {matchLabel}
        </span>
        <button
          className="aspro-icon-btn"
          disabled={!search}
          onClick={findPrev}
          title={t('log.findPrev')}
        >
          ↑
        </button>
        <button
          className="aspro-icon-btn"
          disabled={!search}
          onClick={findNext}
          title={t('log.findNext')}
        >
          ↓
        </button>

        <div className="aspro-search compact min-w-0 flex-1">
          <span>⧩</span>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('log.filterPlaceholder')}
            aria-label={t('log.filterPlaceholder')}
          />
        </div>

        <button className="aspro-icon-btn" onClick={copyAll} title={t('log.copyAll')}>
          {copied ? '✓' : '⧉'}
        </button>
        <button className="aspro-icon-btn" onClick={clearScreen} title={t('log.clear')}>
          ⌫
        </button>
      </div>

      <div ref={containerRef} className="aspro-xterm min-h-0 w-full flex-1 bg-abyss p-2" />
    </div>
  );
}
