import type { DragEvent, ReactNode } from 'react';
import { useMemo, useState } from 'react';
import type { ConnectionStatus, SessionConfig } from '../shared/types';
import { useI18n } from '../i18n';

const STATUS_STYLE: Record<ConnectionStatus, { dot: string; label: string }> = {
  disconnected: { dot: 'bg-ghost', label: 'Terputus' },
  connecting: { dot: 'bg-amber animate-pulse', label: 'Menghubungkan' },
  connected: { dot: 'bg-mint', label: 'Terhubung' },
  reconnecting: { dot: 'bg-amber animate-pulse', label: 'Menyambung ulang' },
  error: { dot: 'bg-coral', label: 'Gagal' },
};

const UNGROUPED = '__ungrouped__';

interface SessionSidebarProps {
  sessions: SessionConfig[];
  statuses: Record<string, ConnectionStatus>;
  errors: Record<string, string>;
  activeId: string | null;
  onSelect: (sessionId: string) => void;
  onConnect: (sessionId: string) => void;
  onDisconnect: (sessionId: string) => void;
  onEdit: (session: SessionConfig) => void;
  onRemove: (sessionId: string) => void;
  onMoveGroup: (sessionId: string, group?: string) => Promise<void>;
  onCreate: () => void;
  onImport: () => void;
}

export function SessionSidebar({
  sessions,
  statuses,
  errors,
  activeId,
  onSelect,
  onConnect,
  onDisconnect,
  onEdit,
  onRemove,
  onMoveGroup,
  onCreate,
  onImport,
}: SessionSidebarProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragTarget, setDragTarget] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? sessions.filter((session) =>
          [session.name, session.host, session.username, session.group ?? ''].some((field) =>
            field.toLowerCase().includes(needle),
          ),
        )
      : sessions;

    const map = new Map<string, SessionConfig[]>();
    for (const session of filtered) {
      const key = session.group?.trim() || UNGROUPED;
      map.set(key, [...(map.get(key) ?? []), session]);
    }

    return [...map.entries()]
      .map(([group, items]) => [
        group,
        [...items].sort((a, b) => a.name.localeCompare(b.name)),
      ] as const)
      .sort(([a], [b]) =>
        a === UNGROUPED ? 1 : b === UNGROUPED ? -1 : a.localeCompare(b),
      );
  }, [sessions, query]);

  const onServerDragStart = (event: DragEvent<HTMLDivElement>, sessionId: string) => {
    setDraggingId(sessionId);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/asproops-session', sessionId);
  };

  const onDropGroup = async (event: DragEvent<HTMLElement>, group: string) => {
    event.preventDefault();
    const sessionId =
      event.dataTransfer.getData('text/asproops-session') || draggingId;
    setDragTarget(null);
    setDraggingId(null);
    if (!sessionId) return;

    const nextGroup = group === UNGROUPED ? undefined : group;
    await onMoveGroup(sessionId, nextGroup);
  };

  return (
    <aside className="aspro-server-explorer">
      <div className="aspro-sidebar-title">
        <div>
          <span>{t('sidebar.title')}</span>
          <small>{t('sidebar.savedServers', { count: sessions.length })}</small>
        </div>
        <button onClick={onImport} title="Import ~/.ssh/config">⇩</button>
      </div>

      <div className="aspro-search">
        <span>⌕</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('sidebar.search')}
          aria-label={t('sidebar.search')}
        />
        <button onClick={onCreate} title={t('app.addServer')}>＋</button>
      </div>

      <div className="aspro-group-hint">
        <span>↕</span>
        {t('sidebar.dragHint')}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto aspro-server-scroll">
        {sessions.length === 0 ? (
          <div className="aspro-empty-sidebar">
            <span className="text-2xl text-violet">▤</span>
            <strong>{t('sidebar.noServer')}</strong>
            <span>{t('sidebar.noServerDetail')}</span>
            <button onClick={onCreate} className="aspro-button aspro-button-primary compact">
              ＋ {t('app.addServer')}
            </button>
          </div>
        ) : grouped.length === 0 ? (
          <p className="p-6 text-center text-xs text-muted">
            {t('sidebar.noResult', { query })}
          </p>
        ) : (
          grouped.map(([group, items]) => {
            const connected = items.filter(
              (session) => statuses[session.id] === 'connected',
            ).length;
            const isDropTarget = dragTarget === group;

            return (
              <section
                key={group}
                className={`aspro-server-group ${isDropTarget ? 'drop-target' : ''}`}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setDragTarget(group);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  setDragTarget(group);
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    setDragTarget(null);
                  }
                }}
                onDrop={(event) => void onDropGroup(event, group)}
              >
                <div className="aspro-group-heading">
                  <button
                    onClick={() =>
                      setCollapsed((previous) => ({
                        ...previous,
                        [group]: !previous[group],
                      }))
                    }
                    className="aspro-group-toggle"
                    title={collapsed[group] ? t('sidebar.openGroup') : t('sidebar.closeGroup')}
                  >
                    <span className={collapsed[group] ? '-rotate-90' : ''}>⌄</span>
                  </button>

                  <span className="aspro-group-icon">▱</span>

                  <button
                    onClick={() =>
                      setCollapsed((previous) => ({
                        ...previous,
                        [group]: !previous[group],
                      }))
                    }
                    className="aspro-group-name"
                  >
                    {group === UNGROUPED ? t('sidebar.ungrouped') : group}
                  </button>

                  {connected > 0 && (
                    <span className="aspro-group-online">{t('sidebar.online', { count: connected })}</span>
                  )}
                  <span className="aspro-group-count">{items.length}</span>
                </div>

                {isDropTarget && draggingId && (
                  <div className="aspro-group-drop-message">
                    {t('sidebar.dropHere', { group: group === UNGROUPED ? t('sidebar.ungrouped') : group })}
                  </div>
                )}

                {!collapsed[group] &&
                  items.map((session) => {
                    const status = statuses[session.id] ?? 'disconnected';
                    const style = STATUS_STYLE[status];
                    const isActive = session.id === activeId;
                    const isDragging = draggingId === session.id;

                    return (
                      <div
                        key={session.id}
                        draggable
                        onDragStart={(event) => onServerDragStart(event, session.id)}
                        onDragEnd={() => {
                          setDraggingId(null);
                          setDragTarget(null);
                        }}
                        className={`aspro-server-row ${isActive ? 'active' : ''} ${
                          isDragging ? 'dragging' : ''
                        }`}
                      >
                        <span className="aspro-drag-grip" title={t('sidebar.dragToGroup')}>⋮⋮</span>

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

                        <button
                          onClick={() => onSelect(session.id)}
                          onDoubleClick={() => onConnect(session.id)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <span className="flex items-center gap-2">
                            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`} />
                            <span className="truncate text-[13px] font-semibold text-dim">
                              {session.name}
                            </span>
                          </span>

                          <span className="mt-0.5 block truncate pl-3.5 font-mono text-[11px] text-faint">
                            {session.username}@{session.host}
                            {session.port !== 22 && `:${session.port}`}
                          </span>

                          {status === 'error' && errors[session.id] && (
                            <span className="mt-1 block truncate pl-3.5 text-[11px] text-coral">
                              {errors[session.id]}
                            </span>
                          )}
                        </button>

                        <div className="aspro-row-actions">
                          {status === 'connected' || status === 'reconnecting' ? (
                            <IconButton
                              label={t('sidebar.disconnect')}
                              onClick={() => onDisconnect(session.id)}
                            >
                              ■
                            </IconButton>
                          ) : (
                            <IconButton
                              label={t('sidebar.connect')}
                              onClick={() => onConnect(session.id)}
                            >
                              ▶
                            </IconButton>
                          )}
                          <IconButton label={t('sidebar.edit')} onClick={() => onEdit(session)}>✎</IconButton>
                          <IconButton label={t('sidebar.delete')} onClick={() => onRemove(session.id)}>×</IconButton>
                        </div>
                      </div>
                    );
                  })}
              </section>
            );
          })
        )}
      </div>

      <button onClick={onCreate} className="aspro-add-group">
        ＋ {t('app.addServer')}
      </button>
    </aside>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="aspro-mini-action"
    >
      {children}
    </button>
  );
}
