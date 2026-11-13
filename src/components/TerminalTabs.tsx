import { useCallback, useEffect, useRef, useState } from 'react';
import { TerminalView } from './TerminalView';
import { useI18n } from '../i18n';

/**
 * Pengelolaan beberapa tab terminal dan pembagian layar (split panes) untuk satu server SSH.
 *
 * Semua tab tetap terpasang di DOM; yang tidak aktif disembunyikan via CSS visibility.
 * Melepasnya akan memutus channel SSH — proses yang berjalan (mis. tail -f, build, server dev)
 * akan mati. Prinsip yang sama berlaku untuk split panes (Pane 1 & Pane 2) agar proses
 * di kedua sisi tetap hidup saat pengguna berpindah antar tab atau fokus.
 */

export type SplitDirection = 'none' | 'vertical' | 'horizontal';

interface Tab {
  id: number;
  /** Ditandai saat shell utama berakhir, mis. pengguna mengetik `exit`. */
  closed: boolean;
  /** Arah pembagian layar: none (layar tunggal), vertical (kiri|kanan), horizontal (atas/bawah). */
  splitDirection: SplitDirection;
  /** Rasio lebar/tinggi pane 1 vs pane 2 (0.15 - 0.85, default: 0.50). */
  splitRatio: number;
  /** Pane mana yang sedang aktif menerima ketikan keyboard dan masukan snippet. */
  activePane: 'primary' | 'secondary';
  /** Ditandai saat shell sekunder berakhir. */
  secondaryClosed?: boolean;
}

interface TerminalTabsProps {
  sessionId: string;
  sessionName?: string;
  /** Panel terminal sedang terlihat. Tab tetap hidup saat ini false. */
  visible: boolean;
}

/**
 * Pembatas panel yang dapat digeser (draggable splitter) untuk mengatur ukuran split panes.
 */
function SplitDivider({
  direction,
  containerRef,
  onRatioChange,
}: {
  direction: 'vertical' | 'horizontal';
  containerRef: React.RefObject<HTMLDivElement | null>;
  onRatioChange: (ratio: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const isVertical = direction === 'vertical';

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setDragging(true);

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const newRatio = isVertical
          ? (moveEvent.clientX - rect.left) / rect.width
          : (moveEvent.clientY - rect.top) / rect.height;
        onRatioChange(Math.max(0.15, Math.min(0.85, newRatio)));
      };

      const handleMouseUp = () => {
        setDragging(false);
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };

      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [direction, isVertical, containerRef, onRatioChange],
  );

  const handleDoubleClick = useCallback(() => {
    onRatioChange(0.5);
  }, [onRatioChange]);

  return (
    <>
      {dragging && (
        <div
          className={`fixed inset-0 z-50 select-none ${
            isVertical ? 'cursor-col-resize' : 'cursor-row-resize'
          }`}
        />
      )}
      <div
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
        role="separator"
        aria-orientation={isVertical ? 'vertical' : 'horizontal'}
        className={`relative z-20 flex shrink-0 items-center justify-center transition-colors select-none ${
          isVertical
            ? 'w-1.5 h-full cursor-col-resize bg-line hover:bg-azure/80 active:bg-azure'
            : 'h-1.5 w-full cursor-row-resize bg-line hover:bg-azure/80 active:bg-azure'
        } ${dragging ? 'bg-azure' : ''}`}
        title="Geser untuk mengatur ukuran panel (klik ganda untuk 50/50)"
      >
        {isVertical ? (
          <div className="h-6 w-0.5 rounded-full bg-dim/60 pointer-events-none" />
        ) : (
          <div className="h-0.5 w-6 rounded-full bg-dim/60 pointer-events-none" />
        )}
      </div>
    </>
  );
}

function TerminalTabPane({
  sessionId,
  sessionName,
  tab,
  active,
  onAdd,
  onClose,
  onClosedPrimary,
  onClosedSecondary,
  onSplitVertical,
  onSplitHorizontal,
  onCloseSplit,
  onSetActivePane,
  onSetRatio,
}: {
  sessionId: string;
  sessionName?: string;
  tab: Tab;
  active: boolean;
  onAdd: () => void;
  onClose: (id: number) => void;
  onClosedPrimary: (id: number) => void;
  onClosedSecondary: (id: number) => void;
  onSplitVertical: (id: number) => void;
  onSplitHorizontal: (id: number) => void;
  onCloseSplit: (id: number) => void;
  onSetActivePane: (id: number, pane: 'primary' | 'secondary') => void;
  onSetRatio: (id: number, ratio: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isSplit = tab.splitDirection !== 'none';
  const isVertical = tab.splitDirection === 'vertical';

  return (
    <div
      ref={containerRef}
      className={`relative h-full w-full overflow-hidden ${
        isSplit ? (isVertical ? 'flex flex-row' : 'flex flex-col') : ''
      }`}
    >
      {/* Pane 1 (Utama) */}
      <div
        style={
          isSplit
            ? isVertical
              ? { width: `${tab.splitRatio * 100}%` }
              : { height: `${tab.splitRatio * 100}%` }
            : undefined
        }
        className={`relative min-h-0 min-w-0 flex flex-col ${
          isSplit ? 'h-full' : 'h-full w-full'
        } ${
          isSplit && tab.activePane === 'primary' ? 'ring-1 ring-inset ring-azure/35' : ''
        }`}
        onClick={() => {
          if (isSplit && tab.activePane !== 'primary') {
            onSetActivePane(tab.id, 'primary');
          }
        }}
      >
        {isSplit && (
          <div className="flex h-5 items-center justify-between border-b border-line/60 bg-abyss/90 px-2 text-[11px] text-faint shrink-0 select-none">
            <span className="flex items-center gap-1.5 font-mono">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  tab.activePane === 'primary' ? 'bg-azure' : 'bg-dim/40'
                }`}
              />
              Pane 1 {tab.closed && <span className="text-coral">×</span>}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSplitHorizontal(tab.id);
                }}
                title="Bagi horizontal (Ctrl+Shift+O)"
                className={`px-1 rounded hover:text-fg ${
                  !isVertical ? 'text-azure font-bold' : 'text-faint'
                }`}
              >
                ⬒
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSplitVertical(tab.id);
                }}
                title="Bagi vertikal (Ctrl+Shift+E)"
                className={`px-1 rounded hover:text-fg ${
                  isVertical ? 'text-azure font-bold' : 'text-faint'
                }`}
              >
                ◫
              </button>
            </div>
          </div>
        )}
        <div className="min-h-0 flex-1 relative">
          <TerminalView
            key={`pane-${tab.id}-primary`}
            sessionId={sessionId}
            sessionName={sessionName}
            active={active && (!isSplit || tab.activePane === 'primary')}
            onRequestNewTab={onAdd}
            onRequestCloseTab={() => onClose(tab.id)}
            onRequestSplitVertical={() => onSplitVertical(tab.id)}
            onRequestSplitHorizontal={() => onSplitHorizontal(tab.id)}
            onRequestCloseSplit={() => onCloseSplit(tab.id)}
            isSplit={isSplit}
            onFocusChange={() => onSetActivePane(tab.id, 'primary')}
            onExit={() => onClosedPrimary(tab.id)}
          />
        </div>
      </div>

      {/* Draggable Divider */}
      {isSplit && (
        <SplitDivider
          direction={tab.splitDirection as 'vertical' | 'horizontal'}
          containerRef={containerRef}
          onRatioChange={(r) => onSetRatio(tab.id, r)}
        />
      )}

      {/* Pane 2 (Sekunder) */}
      {isSplit && (
        <div
          style={
            isVertical
              ? { width: `${(1 - tab.splitRatio) * 100}%` }
              : { height: `${(1 - tab.splitRatio) * 100}%` }
          }
          className={`relative min-h-0 min-w-0 flex flex-col h-full ${
            tab.activePane === 'secondary' ? 'ring-1 ring-inset ring-azure/35' : ''
          }`}
          onClick={() => {
            if (tab.activePane !== 'secondary') {
              onSetActivePane(tab.id, 'secondary');
            }
          }}
        >
          <div className="flex h-5 items-center justify-between border-b border-line/60 bg-abyss/90 px-2 text-[11px] text-faint shrink-0 select-none">
            <span className="flex items-center gap-1.5 font-mono">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  tab.activePane === 'secondary' ? 'bg-azure' : 'bg-dim/40'
                }`}
              />
              Pane 2 {tab.secondaryClosed && <span className="text-coral">×</span>}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCloseSplit(tab.id);
              }}
              title="Tutup pane kedua (Ctrl+Shift+W)"
              className="rounded px-1 text-faint hover:bg-line hover:text-coral transition-colors"
            >
              ✕
            </button>
          </div>
          <div className="min-h-0 flex-1 relative">
            <TerminalView
              key={`pane-${tab.id}-secondary`}
              sessionId={sessionId}
              sessionName={sessionName ? `${sessionName} (Split)` : undefined}
              active={active && tab.activePane === 'secondary'}
              onRequestNewTab={onAdd}
              onRequestCloseTab={() => onCloseSplit(tab.id)}
              onRequestSplitVertical={() => onSplitVertical(tab.id)}
              onRequestSplitHorizontal={() => onSplitHorizontal(tab.id)}
              onRequestCloseSplit={() => onCloseSplit(tab.id)}
              isSplit={true}
              onFocusChange={() => onSetActivePane(tab.id, 'secondary')}
              onExit={() => onClosedSecondary(tab.id)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export function TerminalTabs({ sessionId, sessionName, visible }: TerminalTabsProps) {
  const { t } = useI18n();
  const [tabs, setTabs] = useState<Tab[]>([
    {
      id: 1,
      closed: false,
      splitDirection: 'none',
      splitRatio: 0.5,
      activePane: 'primary',
      secondaryClosed: false,
    },
  ]);
  const [activeId, setActiveId] = useState(1);
  const [nextId, setNextId] = useState(2);

  const addTab = useCallback(() => {
    setTabs((prev) => [
      ...prev,
      {
        id: nextId,
        closed: false,
        splitDirection: 'none',
        splitRatio: 0.5,
        activePane: 'primary',
        secondaryClosed: false,
      },
    ]);
    setActiveId(nextId);
    setNextId((prev) => prev + 1);
  }, [nextId]);

  // Fallback listener untuk penambahan terminal baru
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId: string }>).detail;
      if (detail?.sessionId === sessionId) addTab();
    };
    window.addEventListener('asproops:new-terminal', handler);
    return () => window.removeEventListener('asproops:new-terminal', handler);
  }, [sessionId, addTab]);

  const closeTab = useCallback((id: number) => {
    setTabs((prev) => {
      if (prev.length === 1) return prev;
      const index = prev.findIndex((tab) => tab.id === id);
      const remaining = prev.filter((tab) => tab.id !== id);
      setActiveId((current) => {
        if (current !== id) return current;
        const neighbour = remaining[Math.min(index, remaining.length - 1)];
        return neighbour?.id ?? current;
      });
      return remaining;
    });
  }, []);

  const markClosedPrimary = useCallback((id: number) => {
    setTabs((prev) =>
      prev.map((tab) => (tab.id === id ? { ...tab, closed: true } : tab)),
    );
  }, []);

  const markClosedSecondary = useCallback((id: number) => {
    // Ketika shell kedua selesai (mis. user ketik exit), otomatis tutup split pane
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === id
          ? { ...tab, splitDirection: 'none', activePane: 'primary', secondaryClosed: true }
          : tab,
      ),
    );
  }, []);

  const handleSplitVertical = useCallback((id: number) => {
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === id
          ? {
              ...tab,
              splitDirection: 'vertical',
              activePane: 'secondary',
              secondaryClosed: false,
            }
          : tab,
      ),
    );
  }, []);

  const handleSplitHorizontal = useCallback((id: number) => {
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === id
          ? {
              ...tab,
              splitDirection: 'horizontal',
              activePane: 'secondary',
              secondaryClosed: false,
            }
          : tab,
      ),
    );
  }, []);

  const handleToggleSplitDirection = useCallback((id: number) => {
    setTabs((prev) =>
      prev.map((tab) => {
        if (tab.id !== id) return tab;
        const nextDir = tab.splitDirection === 'vertical' ? 'horizontal' : 'vertical';
        return { ...tab, splitDirection: nextDir };
      }),
    );
  }, []);

  const handleCloseSplit = useCallback((id: number) => {
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === id
          ? {
              ...tab,
              splitDirection: 'none',
              activePane: 'primary',
              secondaryClosed: false,
            }
          : tab,
      ),
    );
  }, []);

  const handleSetActivePane = useCallback(
    (id: number, pane: 'primary' | 'secondary') => {
      setTabs((prev) =>
        prev.map((tab) => (tab.id === id ? { ...tab, activePane: pane } : tab)),
      );
    },
    [],
  );

  const handleSetRatio = useCallback((id: number, ratio: number) => {
    setTabs((prev) =>
      prev.map((tab) => (tab.id === id ? { ...tab, splitRatio: ratio } : tab)),
    );
  }, []);

  // Global listeners untuk split commands
  useEffect(() => {
    const handleSplitV = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string }>).detail;
      if (!detail?.sessionId || detail.sessionId === sessionId) {
        handleSplitVertical(activeId);
      }
    };
    const handleSplitH = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string }>).detail;
      if (!detail?.sessionId || detail.sessionId === sessionId) {
        handleSplitHorizontal(activeId);
      }
    };
    const handleCloseS = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string }>).detail;
      if (!detail?.sessionId || detail.sessionId === sessionId) {
        handleCloseSplit(activeId);
      }
    };

    window.addEventListener('asproops:split-vertical', handleSplitV);
    window.addEventListener('asproops:split-horizontal', handleSplitH);
    window.addEventListener('asproops:close-split', handleCloseS);
    return () => {
      window.removeEventListener('asproops:split-vertical', handleSplitV);
      window.removeEventListener('asproops:split-horizontal', handleSplitH);
      window.removeEventListener('asproops:close-split', handleCloseS);
    };
  }, [sessionId, activeId, handleSplitVertical, handleSplitHorizontal, handleCloseSplit]);

  const currentTab = tabs.find((t) => t.id === activeId) ?? tabs[0];
  const isCurrentSplit = currentTab?.splitDirection !== 'none';

  return (
    <div className="flex h-full flex-col bg-abyss">
      {/* Tab bar header dengan split controls */}
      <div
        role="tablist"
        aria-label="Terminal"
        className="aspro-terminal-tabs flex items-center justify-between border-b border-line bg-panel/60 px-2 py-0.5"
      >
        <div className="flex items-center gap-1 min-w-0 overflow-x-auto py-0.5">
          {tabs.map((tab, index) => (
            <div
              key={tab.id}
              className={`group flex items-center gap-1.5 rounded-t px-3 py-1.5 text-xs transition-colors ${
                tab.id === activeId
                  ? 'aspro-tab-active text-fg bg-abyss border-b-2 border-azure'
                  : 'text-faint hover:text-dim hover:bg-abyss/40'
              }`}
            >
              <button
                role="tab"
                aria-selected={tab.id === activeId}
                onClick={() => setActiveId(tab.id)}
                className="focus:outline-none focus-visible:ring-2 focus-visible:ring-azure flex items-center gap-1"
              >
                {tab.closed && (
                  <span aria-hidden className="text-coral">
                    ×
                  </span>
                )}
                <span>Terminal {index + 1}</span>
                {tab.splitDirection !== 'none' && (
                  <span className="ml-1 text-[10px] text-azure opacity-80">
                    {tab.splitDirection === 'vertical' ? '◫' : '⬒'}
                  </span>
                )}
              </button>
              {tabs.length > 1 && (
                <button
                  onClick={() => closeTab(tab.id)}
                  aria-label={`Tutup terminal ${index + 1}`}
                  className="rounded px-1 text-faint opacity-0 transition-opacity hover:bg-line hover:text-fg group-hover:opacity-100 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
                >
                  ✕
                </button>
              )}
            </div>
          ))}

          <button
            onClick={addTab}
            title="Terminal baru (Ctrl+Shift+T)"
            aria-label="Terminal baru"
            className="ml-1 rounded px-2 py-1 text-sm text-faint hover:bg-line hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
          >
            +
          </button>
        </div>

        {/* Split Controls di sisi kanan tab bar */}
        <div className="flex items-center gap-1 shrink-0 ml-2">
          {!isCurrentSplit ? (
            <>
              <button
                onClick={() => handleSplitVertical(activeId)}
                title={t('terminal.splitVertical')}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs text-dim hover:bg-line hover:text-fg transition-colors"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3zm1 0v10h4V3H3zm5 10h5V3H8v10z" />
                </svg>
                <span className="hidden sm:inline">{t('terminal.splitVerticalShort')}</span>
              </button>
              <button
                onClick={() => handleSplitHorizontal(activeId)}
                title={t('terminal.splitHorizontal')}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs text-dim hover:bg-line hover:text-fg transition-colors"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3zm1 0v4h10V3H3zm10 5H3v5h10V8z" />
                </svg>
                <span className="hidden sm:inline">{t('terminal.splitHorizontalShort')}</span>
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => handleToggleSplitDirection(activeId)}
                title={t('terminal.toggleSplitDirection')}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs text-azure bg-azure/10 hover:bg-azure/20 transition-colors"
              >
                {currentTab?.splitDirection === 'vertical' ? (
                  <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3zm1 0v10h4V3H3zm5 10h5V3H8v10z" />
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3zm1 0v4h10V3H3zm10 5H3v5h10V8z" />
                  </svg>
                )}
                <span className="hidden sm:inline">
                  {currentTab?.splitDirection === 'vertical' ? 'Vertical' : 'Horizontal'}
                </span>
              </button>
              <button
                onClick={() => handleCloseSplit(activeId)}
                title={t('terminal.closeSplit')}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs text-coral hover:bg-coral/10 transition-colors"
              >
                ✕ <span className="hidden sm:inline">{t('terminal.closeSplitShort')}</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Area tab panels */}
      <div className="relative min-h-0 flex-1">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            role="tabpanel"
            className={
              tab.id === activeId
                ? 'absolute inset-0'
                : 'pointer-events-none invisible absolute inset-0'
            }
          >
            <TerminalTabPane
              sessionId={sessionId}
              sessionName={sessionName}
              tab={tab}
              active={visible && tab.id === activeId}
              onAdd={addTab}
              onClose={closeTab}
              onClosedPrimary={markClosedPrimary}
              onClosedSecondary={markClosedSecondary}
              onSplitVertical={handleSplitVertical}
              onSplitHorizontal={handleSplitHorizontal}
              onCloseSplit={handleCloseSplit}
              onSetActivePane={handleSetActivePane}
              onSetRatio={handleSetRatio}
            />
          </div>
        ))}
      </div>

      {/* Info bar footer */}
      {tabs.length === 1 && !isCurrentSplit && (
        <div className="flex items-center justify-between border-t border-line bg-panel/70 px-4 py-1 text-[11px] text-faint">
          <span>Ctrl+Shift+T: tab baru | Ctrl+Shift+E: bagi vertikal | Ctrl+Shift+O: bagi horizontal</span>
          <button
            onClick={addTab}
            className="rounded px-2 py-0.5 hover:bg-line hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
          >
            + Terminal baru
          </button>
        </div>
      )}
    </div>
  );
}
