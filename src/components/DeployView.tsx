import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import type { DeployRunEvent } from '../shared/types';
import { useTerminalPrefs } from '../terminalPrefs';
import { useI18n } from '../i18n';
import { ContextMenu, ContextMenuItem, type ContextMenuPosition } from './ContextMenu';

/**
 * Tab live output untuk satu proses deploy — arsitektur sama seperti
 * LogView (xterm read-only, convertEol karena exec channel tanpa PTY tidak
 * mengirim "\r"), tapi tanpa filter/search karena output deploy biasanya
 * jauh lebih pendek daripada log yang di-tail terus-menerus.
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

type RunState = 'running' | 'success' | 'failed';

interface DeployViewProps {
  sessionId: string;
  projectId: string;
  active: boolean;
  onExit?: () => void;
  /** Kalau terisi, tab ini menjalankan rollback ke entri riwayat ini alih-alih deploy baru. */
  rollbackEntryId?: string;
}

export function DeployView({ sessionId, projectId, active, onExit, rollbackEntryId }: DeployViewProps) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const runIdRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runState, setRunState] = useState<RunState>('running');
  const [contextMenu, setContextMenu] = useState<ContextMenuPosition | null>(null);

  const { prefs } = useTerminalPrefs();
  const prefsRef = useRef(prefs);
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
      // exec channel tanpa PTY -> "\n" polos tanpa "\r", sama seperti LogView.
      convertEol: true,
      theme: THEME,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());

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

    // Subscribe SEBELUM memanggil deploy:run — event step pertama bisa
    // langsung terpicu sinkron di sisi main sebelum promise run() ini
    // resolve, jadi event yang datang lebih dulu dari runId-nya sendiri
    // ditampung dulu di buffer, bukan dibuang.
    const buffered: DeployRunEvent[] = [];
    let knownRunId: string | null = null;

    const handleEvent = (event: DeployRunEvent) => {
      switch (event.type) {
        case 'stepStart':
          term.write(`\x1b[1;36m▶ ${t('deploy.step', { index: (event.stepIndex ?? 0) + 1, label: event.stepLabel ?? '' })}\x1b[0m\r\n`);
          break;
        case 'output':
          term.write(event.data ?? '');
          break;
        case 'stepEnd': {
          const ok = event.exitCode === 0;
          const color = ok ? '\x1b[32m' : '\x1b[31m';
          term.write(`${color}${ok ? '✓' : '✗'} exit ${event.exitCode}\x1b[0m\r\n\r\n`);
          break;
        }
        case 'done':
          setRunState(event.success ? 'success' : 'failed');
          if (event.message) {
            term.write(`\x1b[${event.success ? '32' : '31'}m${event.message}\x1b[0m\r\n`);
          }
          break;
      }
    };

    const unsubscribe = window.ssh.deploy.onEvent((event) => {
      if (knownRunId) {
        if (event.runId === knownRunId) handleEvent(event);
        return;
      }
      buffered.push(event);
    });

    const initialize = () => {
      if (disposed) return;

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
          const runId = rollbackEntryId
            ? await window.ssh.deploy.rollback(sessionId, projectId, rollbackEntryId)
            : await window.ssh.deploy.run(sessionId, projectId);
          if (disposed) {
            window.ssh.deploy.cancel(runId);
            return;
          }
          runIdRef.current = runId;
          knownRunId = runId;
          for (const event of buffered) {
            if (event.runId === runId) handleEvent(event);
          }
          buffered.length = 0;
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
      unsubscribe();
      if (runIdRef.current) window.ssh.deploy.cancel(runIdRef.current);
      if (opened) term.dispose();
      termRef.current = null;
      fitRef.current = null;
      runIdRef.current = null;
    };
  // sessionId+projectId+rollbackEntryId saja: satu run dipicu sekali per mount, tidak diulang tiap render.
  }, [sessionId, projectId, rollbackEntryId]);

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

  const cancelRun = () => {
    if (runIdRef.current) window.ssh.deploy.cancel(runIdRef.current);
    onExit?.();
  };

  const handleContextMenu = (event: ReactMouseEvent) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY });
  };

  const copySelection = () => {
    const selection = termRef.current?.getSelection();
    if (selection) window.ssh.clipboard.writeText(selection);
    setContextMenu(null);
  };

  if (error) {
    return (
      <div className="flex h-full items-center justify-center bg-abyss p-8 text-center">
        <div>
          <p className="text-sm text-coral">{t('deploy.startFailed')}</p>
          <p className="mt-2 text-xs text-muted">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {runState === 'running' && (
        <div className="flex shrink-0 items-center justify-between border-b border-line bg-panel/70 px-3 py-1.5 text-xs text-faint">
          <span>{t('deploy.running')}</span>
          <button
            onClick={cancelRun}
            className="rounded border border-line px-2 py-1 text-[11px] text-coral hover:border-coral focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
          >
            {t('deploy.cancel')}
          </button>
        </div>
      )}

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
