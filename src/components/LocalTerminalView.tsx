import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import '@xterm/xterm/css/xterm.css';

import type { LocalTerminalProfile } from '../shared/types';
import { useTerminalPrefs } from '../terminalPrefs';
import { ContextMenu, ContextMenuItem, type ContextMenuPosition } from './ContextMenu';
import { useI18n } from '../i18n';

function defaultFontFamily(): string {
  return (
    getComputedStyle(document.documentElement).getPropertyValue('--font-mono') ||
    'Cascadia Code, Consolas, monospace'
  );
}

interface LocalTerminalViewProps {
  workspaceId: string;
  profile: LocalTerminalProfile;
  active: boolean;
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

export function LocalTerminalView({
  workspaceId,
  profile,
  active,
  onExit,
}: LocalTerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const terminalIdRef = useRef<string | null>(null);
  const exitRef = useRef(onExit);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(active);
  const [contextMenu, setContextMenu] = useState<ContextMenuPosition | null>(null);

  const { t } = useI18n();
  const { prefs } = useTerminalPrefs();
  const prefsRef = useRef(prefs);

  exitRef.current = onExit;
  prefsRef.current = prefs;

  useEffect(() => {
    if (active) setInitialized(true);
  }, [active]);

  useEffect(() => {
    if (!initialized) return;

    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let frame = 0;
    let observer: ResizeObserver | null = null;
    const unsubscribers: Array<() => void> = [];

    const initialize = () => {
      if (disposed || termRef.current) return;

      // xterm membutuhkan container yang sudah masuk layout dan memiliki ukuran.
      // Workspace yang masih tersembunyi tidak boleh di-open.
      if (container.clientWidth < 20 || container.clientHeight < 20) {
        frame = requestAnimationFrame(initialize);
        return;
      }

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

      const unicode = new Unicode11Addon();
      term.loadAddon(unicode);
      term.unicode.activeVersion = '11';

      // Ctrl+Shift+C/V (bukan Ctrl+C/V polos, yang dipakai shell untuk SIGINT/dll).
      term.attachCustomKeyEventHandler((event) => {
        if (event.type !== 'keydown' || !event.ctrlKey || !event.shiftKey) return true;
        const key = event.key.toLowerCase();
        if (key === 'c') {
          const selection = term.getSelection();
          if (selection) window.ssh.clipboard.writeText(selection);
          return false;
        }
        if (key === 'v') {
          const text = window.ssh.clipboard.readText();
          if (text && terminalIdRef.current) window.ssh.local.write(terminalIdRef.current, text);
          return false;
        }
        return true;
      });

      term.open(container);
      termRef.current = term;
      fitRef.current = fit;

      // Tunggu satu frame lagi setelah open agar renderer xterm selesai
      // mengukur font/canvas sebelum FitAddon dipanggil.
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
          const terminalId = await window.ssh.local.open(profile.id, term.cols, term.rows);
          if (disposed) {
            window.ssh.local.close(terminalId);
            return;
          }

          terminalIdRef.current = terminalId;

          unsubscribers.push(
            window.ssh.local.onData(({ terminalId: source, data }) => {
              if (source === terminalId) term.write(data);
            }),
            window.ssh.local.onClose(({ terminalId: source }) => {
              if (source !== terminalId) return;
              terminalIdRef.current = null;
              exitRef.current?.();
            }),
          );

          term.onData((data) => window.ssh.local.write(terminalId, data));
        } catch (err) {
          setError((err as Error).message);
        }
      })();

      observer = new ResizeObserver(() => {
        if (
          disposed ||
          container.clientWidth < 20 ||
          container.clientHeight < 20 ||
          !termRef.current ||
          !fitRef.current
        ) {
          return;
        }

        try {
          fitRef.current.fit();
        } catch {
          return;
        }

        if (terminalIdRef.current) {
          window.ssh.local.resize(
            terminalIdRef.current,
            termRef.current.cols,
            termRef.current.rows,
          );
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
        window.ssh.local.close(terminalIdRef.current);
      }

      termRef.current?.dispose();
      termRef.current = null;
      fitRef.current = null;
      terminalIdRef.current = null;
    };
  // initialized hanya berubah false -> true sekali. Setelah terminal dibuat,
  // pindah tab tidak membongkar PTY.
  }, [initialized, workspaceId, profile.id]);

  // Terapkan perubahan preferensi ke terminal yang sudah terbuka, tanpa
  // menutup PTY-nya (beda effect dari effect mount di atas).
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

    const frame = requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!container || container.clientWidth < 20 || container.clientHeight < 20) return;

      try {
        fit.fit();
      } catch {
        return;
      }

      if (terminalIdRef.current) {
        window.ssh.local.resize(terminalIdRef.current, term.cols, term.rows);
      }
      term.focus();
    });

    return () => cancelAnimationFrame(frame);
  }, [active]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center bg-abyss p-8 text-center">
        <div>
          <p className="text-sm text-coral">Terminal lokal tidak bisa dibuka.</p>
          <p className="mt-2 text-xs text-muted">{error}</p>
        </div>
      </div>
    );
  }

  const handleContextMenu = (event: ReactMouseEvent) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY });
  };

  const copySelection = () => {
    const selection = termRef.current?.getSelection();
    if (selection) window.ssh.clipboard.writeText(selection);
    setContextMenu(null);
  };

  const pasteClipboard = () => {
    const text = window.ssh.clipboard.readText();
    if (text && terminalIdRef.current) window.ssh.local.write(terminalIdRef.current, text);
    setContextMenu(null);
  };

  return (
    <>
      <div
        ref={containerRef}
        className="aspro-xterm h-full w-full bg-abyss p-2"
        onContextMenu={handleContextMenu}
      />
      {contextMenu && (
        <ContextMenu position={contextMenu} onClose={() => setContextMenu(null)}>
          <ContextMenuItem onClick={copySelection} disabled={!termRef.current?.hasSelection()}>
            {t('menu.copy')}
          </ContextMenuItem>
          <ContextMenuItem onClick={pasteClipboard}>{t('menu.paste')}</ContextMenuItem>
        </ContextMenu>
      )}
    </>
  );
}
