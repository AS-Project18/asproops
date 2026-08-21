import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import { useTerminalPrefs } from '../terminalPrefs';
import { stripAnsi } from '../lib/ansi';
import { colorizeLine, nextBlockLevel, blockPrefix, type BlockLevel } from '../lib/logColorize';
import { useI18n } from '../i18n';
import { ContextMenu, ContextMenuItem, type ContextMenuPosition } from './ContextMenu';

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

interface LogStreamViewProps {
  /** Stream sudah terbuka di main process — komponen ini murni menampilkannya. */
  tailId: string;
  active: boolean;
  onExit?: () => void;
}

/**
 * Bagian tampilan (xterm + search/filter/colorize/copy) yang dipakai bersama
 * oleh LogView (tail berkas project) dan AuthLogPanel (log login server) —
 * keduanya cuma beda cara MEMBUKA tail-nya, tapi sama-sama berujung ke satu
 * tailId yang mengalir lewat event log:data/log:close yang sama.
 */
export function LogStreamView({ tailId, active, onExit }: LogStreamViewProps) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);

  // Baris lengkap (sudah diakhiri \n) yang sudah diterima, dipakai untuk
  // menyusun ulang tampilan saat filter berubah. `partial` menyimpan sisa
  // baris yang belum lengkap karena chunk stream terpotong di tengah baris.
  const linesRef = useRef<string[]>([]);
  const partialRef = useRef('');
  const filterRef = useRef('');
  const colorRef = useRef(true);
  const blockLevelRef = useRef<BlockLevel>(null);

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('');
  const [colorEnabled, setColorEnabled] = useState(true);
  const [matchInfo, setMatchInfo] = useState<{ index: number; count: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuPosition | null>(null);

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
        if (selection) window.ssh.clipboard.writeText(selection);
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

    // Baris ditulis utuh (bukan chunk mentah per-karakter) supaya bisa
    // diwarnai per baris — konsekuensinya baris yang belum diakhiri "\n"
    // ditahan dulu di partialRef sampai lengkap, baru ditulis+diwarnai.
    const ingest = (chunk: string) => {
      const combined = partialRef.current + chunk;
      const parts = combined.split('\n');
      partialRef.current = parts.pop() ?? '';
      if (parts.length === 0) return;

      linesRef.current.push(...parts);
      const overflow = linesRef.current.length - MAX_BUFFERED_LINES;
      if (overflow > 0) linesRef.current.splice(0, overflow);

      // Pelacakan blok jalan atas SEMUA baris berurutan, bukan cuma yang
      // lolos filter — kalau tidak, baris lanjutan yang tersaring keluar
      // bisa membuat statusnya melenceng dari blok aslinya.
      const rendered = parts.map((line) => {
        const level = nextBlockLevel(line, blockLevelRef.current);
        blockLevelRef.current = level;
        return colorRef.current ? blockPrefix(level) + colorizeLine(line) : line;
      });

      if (!filterRef.current) {
        term.write(rendered.join('\n') + '\n');
        return;
      }

      const query = filterRef.current.toLowerCase();
      const matched = rendered.filter((_, i) => stripAnsi(parts[i]).toLowerCase().includes(query));
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
      if (opened) term.dispose();
      termRef.current = null;
      fitRef.current = null;
      searchAddonRef.current = null;
      linesRef.current = [];
      partialRef.current = '';
      blockLevelRef.current = null;
    };
  // tailId saja sebagai dependency: buka tutup viewer ulang cuma kalau
  // stream-nya sungguh berganti, bukan tiap render ulang parent.
  //
  // SENGAJA tidak memanggil window.ssh.log.close(tailId) di sini. Komponen
  // ini cuma MENAMPILKAN tailId yang sudah dibuka orang lain (LogView atau
  // AuthLogPanel) — tailId itu prop, bukan sesuatu yang dibuka di efek ini,
  // jadi menutupnya di cleanup efek ini melanggar simetri buka/tutup. Di
  // React StrictMode (dev), tiap mount disimulasikan mount->cleanup->mount
  // lagi untuk komponen yang SAMA — kalau cleanup ini menutup stream
  // sungguhan, simulasi itu benar-benar mematikan `journalctl -f`/`tail -F`
  // yang masih dipakai, lalu listener yang baru dipasang ulang menangkap
  // event close itu dan memicu reprobe — meletup-letup tanpa henti setiap
  // panel ini pertama kali muncul. Yang membuka tailId (lewat sessionId+path
  // di LogView, atau lewat authLog.open di AuthLogPanel) itu juga yang
  // wajib menutupnya, simetris di efek yang sama.
  }, [tailId]);

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

  // Susun ulang buffer setiap filter atau toggle warna berubah — didebounce
  // ringan supaya mengetik cepat tidak memicu clear+rewrite ribuan baris
  // tiap huruf. linesRef selalu menyimpan teks polos (tidak diwarnai),
  // pewarnaan cuma diterapkan saat ditulis ke terminal.
  useEffect(() => {
    const handle = setTimeout(() => {
      filterRef.current = filter;
      colorRef.current = colorEnabled;
      const term = termRef.current;
      if (!term) return;

      term.clear();
      const query = filter.toLowerCase();

      // Susun ulang dari baris PALING AWAL yang tersisa di buffer supaya
      // pelacakan blok akurat, baru saring untuk tampilan.
      let level: BlockLevel = null;
      const renderedAll = linesRef.current.map((line) => {
        level = nextBlockLevel(line, level);
        return colorEnabled ? blockPrefix(level) + colorizeLine(line) : line;
      });
      blockLevelRef.current = level;

      const visible = filter
        ? renderedAll.filter((_, i) => stripAnsi(linesRef.current[i]).toLowerCase().includes(query))
        : renderedAll;
      if (visible.length > 0) term.write(visible.join('\n') + '\n');
      if (!filter && partialRef.current) term.write(partialRef.current);
    }, 200);
    return () => clearTimeout(handle);
  }, [filter, colorEnabled]);

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
    window.ssh.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const clearScreen = () => {
    linesRef.current = [];
    partialRef.current = '';
    blockLevelRef.current = null;
    termRef.current?.clear();
  };

  const copySelection = () => {
    const selection = termRef.current?.getSelection();
    if (selection) window.ssh.clipboard.writeText(selection);
    setContextMenu(null);
  };

  const handleContextMenu = (event: ReactMouseEvent) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY });
  };

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

        <button
          className="aspro-icon-btn"
          onClick={() => setColorEnabled((v) => !v)}
          title={colorEnabled ? t('log.colorOn') : t('log.colorOff')}
        >
          {colorEnabled ? '◉' : '◎'}
        </button>
        <button className="aspro-icon-btn" onClick={copyAll} title={t('log.copyAll')}>
          {copied ? '✓' : '⧉'}
        </button>
        <button className="aspro-icon-btn" onClick={clearScreen} title={t('log.clear')}>
          ⌫
        </button>
      </div>

      {/* Padding hidup di div LUAR ini, bukan di div yang di-term.open()-kan —
          FitAddon xterm.js membaca padding dari elemen .xterm internalnya
          sendiri (selalu 0), bukan dari container yang diukurnya, sehingga
          overestimate jumlah baris yang muat kalau padding ditaruh di situ. */}
      <div className="aspro-xterm min-h-0 w-full flex-1 bg-abyss p-2">
        <div ref={containerRef} className="h-full w-full" onContextMenu={handleContextMenu} />
      </div>

      {contextMenu && (
        <ContextMenu position={contextMenu} onClose={() => setContextMenu(null)}>
          <ContextMenuItem onClick={copySelection} disabled={!termRef.current?.hasSelection()}>
            {t('menu.copy')}
          </ContextMenuItem>
        </ContextMenu>
      )}
    </div>
  );
}

interface LogViewProps {
  sessionId: string;
  path: string;
  active: boolean;
  onExit?: () => void;
}

/** Tail berkas log project — thin wrapper: buka tail lewat log:open, lalu serahkan tampilannya ke LogStreamView. */
export function LogView({ sessionId, path, active, onExit }: LogViewProps) {
  const [tailId, setTailId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const exitRef = useRef(onExit);
  exitRef.current = onExit;

  useEffect(() => {
    let disposed = false;
    let openedTailId: string | null = null;

    void (async () => {
      try {
        const id = await window.ssh.log.open(sessionId, path);
        if (disposed) {
          window.ssh.log.close(id);
          return;
        }
        openedTailId = id;
        setTailId(id);
      } catch (err) {
        if (!disposed) setError((err as Error).message);
      }
    })();

    return () => {
      disposed = true;
      setTailId(null);
      // LogStreamView TIDAK menutup tailId-nya sendiri (lihat catatan di
      // sana) — komponen inilah yang membuka lewat log:open, jadi komponen
      // ini juga yang wajib menutupnya, simetris di efek yang sama.
      if (openedTailId) window.ssh.log.close(openedTailId);
    };
  }, [sessionId, path]);

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

  if (!tailId) return null;

  return <LogStreamView tailId={tailId} active={active} onExit={onExit} />;
}

interface ContainerLogViewProps {
  sessionId: string;
  containerId: string;
  active: boolean;
  onExit?: () => void;
}

/** Tail log container Docker — thin wrapper sama seperti LogView, cuma beda cara membuka tail-nya. */
export function ContainerLogView({ sessionId, containerId, active, onExit }: ContainerLogViewProps) {
  const [tailId, setTailId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let openedTailId: string | null = null;

    void (async () => {
      try {
        const id = await window.ssh.docker.openLogs(sessionId, containerId);
        if (disposed) {
          window.ssh.log.close(id);
          return;
        }
        openedTailId = id;
        setTailId(id);
      } catch (err) {
        if (!disposed) setError((err as Error).message);
      }
    })();

    return () => {
      disposed = true;
      setTailId(null);
      if (openedTailId) window.ssh.log.close(openedTailId);
    };
  }, [sessionId, containerId]);

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

  if (!tailId) return null;

  return <LogStreamView tailId={tailId} active={active} onExit={onExit} />;
}
