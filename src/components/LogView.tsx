import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import { useTerminalPrefs } from '../terminalPrefs';

/**
 * Viewer log live — `tail -F` yang streaming ke xterm read-only.
 *
 * Pakai xterm (bukan <pre> biasa) supaya ANSI color dari log berwarna ikut
 * dirender, dan supaya scrollback besar tetap ringan — persis alasan yang
 * sama kenapa TerminalView pakai xterm. Beda utamanya: tidak ada input yang
 * dikirim balik ke server (disableStdin), dan tidak ada negosiasi ukuran
 * PTY karena `tail -F` bukan proses interaktif.
 */

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
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const tailIdRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      theme: THEME,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.loadAddon(new SearchAddon());

    termRef.current = term;
    fitRef.current = fit;

    let disposed = false;
    let opened = false;
    let frame = 0;
    let observer: ResizeObserver | null = null;
    const unsubscribers: Array<() => void> = [];

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
              term.write(data);
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
      for (const unsubscribe of unsubscribers) unsubscribe();
      if (tailIdRef.current) window.ssh.log.close(tailIdRef.current);
      if (opened) term.dispose();
      termRef.current = null;
      fitRef.current = null;
      tailIdRef.current = null;
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

  return <div ref={containerRef} className="aspro-xterm h-full w-full bg-abyss p-2" />;
}
