import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { ConnectionStatus, SessionConfig } from '../shared/types';
import { useI18n } from '../i18n';

/**
 * Command palette Ctrl+K — cari server tersimpan lalu langsung connect,
 * tanpa perlu klik ke sidebar. Reuse pola pencarian yang sama seperti
 * SessionSidebar (cocokkan nama/host/username/group).
 */

interface QuickConnectPaletteProps {
  sessions: SessionConfig[];
  statuses: Record<string, ConnectionStatus>;
  onSelect: (sessionId: string) => void;
  onClose: () => void;
}

const STATUS_DOT: Record<ConnectionStatus, string> = {
  disconnected: 'bg-ghost',
  connecting: 'bg-amber animate-pulse',
  connected: 'bg-mint',
  reconnecting: 'bg-amber animate-pulse',
  error: 'bg-coral',
};

export function QuickConnectPalette({ sessions, statuses, onSelect, onClose }: QuickConnectPaletteProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = needle
      ? sessions.filter((s) =>
          [s.name, s.host, s.username, s.group ?? ''].some((f) => f.toLowerCase().includes(needle)),
        )
      : sessions;
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [sessions, query]);

  useEffect(() => setHighlighted(0), [query]);

  const confirm = (session: SessionConfig) => {
    onSelect(session.id);
    onClose();
  };

  const handleKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === 'Escape') {
      onClose();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted((h) => Math.min(h + 1, filtered.length - 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const picked = filtered[highlighted];
      if (picked) confirm(picked);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[150] flex items-start justify-center bg-black/70 pt-[15vh]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-lg border border-line bg-raised shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
          <span className="text-orange">ϟ</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('quickConnect.placeholder')}
            aria-label={t('app.quickConnect')}
            spellCheck={false}
            className="min-w-0 flex-1 border-0 bg-transparent text-sm text-fg outline-none placeholder-faint"
          />
          <span className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] text-faint">
            Esc
          </span>
        </div>

        <div className="max-h-[50vh] overflow-y-auto p-1.5">
          {sessions.length === 0 ? (
            <p className="p-6 text-center text-xs text-faint">{t('sidebar.noServer')}</p>
          ) : filtered.length === 0 ? (
            <p className="p-6 text-center text-xs text-faint">{t('sidebar.noResult', { query })}</p>
          ) : (
            filtered.map((session, index) => {
              const status = statuses[session.id] ?? 'disconnected';
              return (
                <button
                  key={session.id}
                  onClick={() => confirm(session)}
                  onMouseEnter={() => setHighlighted(index)}
                  className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left focus:outline-none ${
                    index === highlighted ? 'bg-active' : 'hover:bg-hover'
                  }`}
                >
                  <span
                    className="aspro-server-avatar"
                    style={
                      session.color
                        ? {
                            color: session.color,
                            borderColor: `${session.color}45`,
                            background: `${session.color}1a`,
                          }
                        : undefined
                    }
                  >
                    {session.name.trim().charAt(0).toUpperCase() || '?'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[status]}`} />
                      <span className="truncate text-sm font-medium text-dim">{session.name}</span>
                    </span>
                    <span className="mt-0.5 block truncate pl-3.5 font-mono text-[11px] text-faint">
                      {session.username}@{session.host}
                      {session.port !== 22 && `:${session.port}`}
                    </span>
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between border-t border-line px-3 py-2 text-[10px] text-faint">
          <span>↑↓ {t('quickConnect.navigate')}</span>
          <span>Enter {t('quickConnect.connect')}</span>
        </div>
      </div>
    </div>
  );
}
