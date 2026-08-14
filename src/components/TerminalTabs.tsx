import { useCallback, useState } from 'react';
import { TerminalView } from './TerminalView';

/**
 * Beberapa terminal untuk satu server.
 *
 * Semua tab tetap terpasang; yang tidak aktif hanya disembunyikan lewat CSS.
 * Melepasnya akan menutup channel SSH — `tail -f` yang sedang berjalan mati
 * dan isi layar hilang. Ini alasan yang sama kenapa `App` menyimpan seluruh
 * blok terminal untuk setiap server yang terhubung.
 */

interface Tab {
  id: number;
  /** Ditandai saat shell-nya berakhir, mis. pengguna mengetik `exit`. */
  closed: boolean;
}

interface TerminalTabsProps {
  sessionId: string;
  /** Panel terminal sedang terlihat. Tab tetap hidup saat ini false. */
  visible: boolean;
}

function TerminalTabPane({
  sessionId,
  tabId,
  active,
  onAdd,
  onClose,
  onClosed,
}: {
  sessionId: string;
  tabId: number;
  active: boolean;
  onAdd: () => void;
  onClose: (id: number) => void;
  onClosed: (id: number) => void;
}) {
  const handleClose = useCallback(() => onClose(tabId), [onClose, tabId]);
  const handleClosed = useCallback(() => onClosed(tabId), [onClosed, tabId]);

  return (
    <TerminalView
      sessionId={sessionId}
      active={active}
      onRequestNewTab={onAdd}
      onRequestCloseTab={handleClose}
      onExit={handleClosed}
    />
  );
}


export function TerminalTabs({ sessionId, visible }: TerminalTabsProps) {
  const [tabs, setTabs] = useState<Tab[]>([{ id: 1, closed: false }]);
  const [activeId, setActiveId] = useState(1);
  const [nextId, setNextId] = useState(2);

  const addTab = useCallback(() => {
    setTabs((prev) => [...prev, { id: nextId, closed: false }]);
    setActiveId(nextId);
    setNextId((prev) => prev + 1);
  }, [nextId]);

  const closeTab = useCallback(
    (id: number) => {
      setTabs((prev) => {
        // Tab terakhir tidak ditutup — panel terminal tanpa terminal sama
        // sekali hanya menyisakan area kosong tanpa jalan kembali.
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
    },
    [],
  );

  const markClosed = useCallback((id: number) => {
    setTabs((prev) => prev.map((tab) => (tab.id === id ? { ...tab, closed: true } : tab)));
  }, []);

  return (
    <div className="flex h-full flex-col bg-abyss">
      {tabs.length > 1 && (
        <div
          role="tablist"
          aria-label="Terminal"
          className="aspro-terminal-tabs flex items-center gap-1 border-b border-line px-2"
        >
          {tabs.map((tab, index) => (
            <div
              key={tab.id}
              className={`group flex items-center gap-1.5 rounded-t px-3 py-1.5 text-xs ${
                tab.id === activeId ? 'aspro-tab-active text-fg' : 'text-faint hover:text-dim'
              }`}
            >
              <button
                role="tab"
                aria-selected={tab.id === activeId}
                onClick={() => setActiveId(tab.id)}
                className="focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
              >
                {tab.closed && (
                  <span aria-hidden className="mr-1 text-coral">
                    ×
                  </span>
                )}
                Terminal {index + 1}
              </button>
              <button
                onClick={() => closeTab(tab.id)}
                aria-label={`Tutup terminal ${index + 1}`}
                className="rounded px-1 text-faint opacity-0 transition-opacity hover:bg-line hover:text-fg group-hover:opacity-100 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
              >
                ✕
              </button>
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
      )}

      <div className="relative min-h-0 flex-1">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            role="tabpanel"
            className={tab.id === activeId ? 'h-full' : 'hidden'}
          >
            <TerminalTabPane
              sessionId={sessionId}
              tabId={tab.id}
              active={visible && tab.id === activeId}
              onAdd={addTab}
              onClose={closeTab}
              onClosed={markClosed}
            />
          </div>
        ))}
      </div>

      {tabs.length === 1 && (
        <div className="flex items-center justify-between border-t border-line bg-panel/70 px-4 py-1.5 text-[10px] text-faint">
          <span>Ctrl+Shift+T untuk terminal baru</span>
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
