import type { DragEvent, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ConnectionStatus, ServerGroupMetadata, SessionConfig } from '../shared/types';
import { useI18n } from '../i18n';

const STATUS_STYLE: Record<ConnectionStatus, { dot: string; label: string }> = {
  disconnected: { dot: 'bg-ghost', label: 'Terputus' },
  connecting: { dot: 'bg-amber animate-pulse', label: 'Menghubungkan' },
  connected: { dot: 'bg-mint', label: 'Terhubung' },
  reconnecting: { dot: 'bg-amber animate-pulse', label: 'Menyambung ulang' },
  error: { dot: 'bg-coral', label: 'Gagal' },
};

const UNGROUPED = '__ungrouped__';
const COLLAPSED_STORAGE_KEY = 'asproops.groups.collapsed.v1';

export const GROUP_ICON_PRESETS = [
  { id: 'folder', icon: '📁', label: 'Folder' },
  { id: 'cloud', icon: '☁️', label: 'Cloud' },
  { id: 'server', icon: '🖥️', label: 'Server' },
  { id: 'database', icon: '🗄️', label: 'Database' },
  { id: 'globe', icon: '🌐', label: 'Web' },
  { id: 'shield', icon: '🛡️', label: 'Security' },
  { id: 'rocket', icon: '🚀', label: 'Prod' },
  { id: 'box', icon: '📦', label: 'Docker' },
  { id: 'bolt', icon: '⚡', label: 'Worker' },
  { id: 'wrench', icon: '🔧', label: 'Ops' },
  { id: 'office', icon: '🏢', label: 'On-Prem' },
  { id: 'lock', icon: '🔒', label: 'Private' },
];

export const GROUP_COLOR_PRESETS = [
  { value: '#c05cff', label: 'Ungu' },
  { value: '#58e879', label: 'Hijau' },
  { value: '#ff5a68', label: 'Merah' },
  { value: '#ff9700', label: 'Oranye' },
  { value: '#38bdf8', label: 'Biru' },
  { value: '#ffd23b', label: 'Kuning' },
  { value: '#f472b6', label: 'Pink' },
  { value: '#a79dac', label: 'Abu-abu' },
];

function resolveGroupIcon(iconId?: string, fallback = '📁'): string {
  if (!iconId) return fallback;
  const match = GROUP_ICON_PRESETS.find((p) => p.id === iconId);
  return match ? match.icon : iconId;
}

function resolveInheritedGroupColor(
  path: string,
  groupsMeta: Record<string, ServerGroupMetadata>,
): string | undefined {
  if (groupsMeta[path]?.color) return groupsMeta[path].color;
  const parts = path.split('/');
  for (let i = parts.length - 1; i >= 1; i--) {
    const ancestor = parts.slice(0, i).join('/');
    if (groupsMeta[ancestor]?.color) {
      return groupsMeta[ancestor].color;
    }
  }
  return undefined;
}

function loadSavedCollapsed(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(COLLAPSED_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

interface GroupEntry {
  key: string;
  fullPath: string;
  displayName: string;
  depth: number;
  metadata?: ServerGroupMetadata;
  color?: string;
  items: SessionConfig[];
  totalCount: number;
  onlineCount: number;
  isParentHidden: boolean;
}

interface GroupModalState {
  open: boolean;
  mode: 'create' | 'edit';
  groupKey: string;
  name: string;
  color: string;
  icon: string;
}

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
  onRefresh?: () => void | Promise<unknown>;
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
  onRefresh,
}: SessionSidebarProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(loadSavedCollapsed);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragTarget, setDragTarget] = useState<string | null>(null);
  const [groupsMeta, setGroupsMeta] = useState<Record<string, ServerGroupMetadata>>({});
  const [groupModal, setGroupModal] = useState<GroupModalState | null>(null);

  const reloadGroups = useCallback(async () => {
    try {
      const meta = await window.ssh.serverGroups.list();
      setGroupsMeta(meta || {});
    } catch {
      // Abaikan jika app masih terkunci
    }
  }, []);

  useEffect(() => {
    void reloadGroups();
  }, [reloadGroups]);

  const treeEntries = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? sessions.filter((session) =>
          [session.name, session.host, session.username, session.group ?? ''].some((field) =>
            field.toLowerCase().includes(needle),
          ),
        )
      : sessions;

    const pathSet = new Set<string>();
    for (const key of Object.keys(groupsMeta)) {
      if (key && key !== UNGROUPED) pathSet.add(key);
    }
    for (const session of sessions) {
      const g = session.group?.trim();
      if (g) pathSet.add(g);
    }

    // Auto-discover ancestor folders (mis. "A/B/C" -> "A" dan "A/B")
    for (const p of Array.from(pathSet)) {
      const parts = p.split('/');
      let current = '';
      for (let i = 0; i < parts.length - 1; i++) {
        current = current ? `${current}/${parts[i]}` : parts[i];
        pathSet.add(current);
      }
    }

    const sessionMap = new Map<string, SessionConfig[]>();
    for (const s of filtered) {
      const key = s.group?.trim() || UNGROUPED;
      sessionMap.set(key, [...(sessionMap.get(key) ?? []), s]);
    }

    const sortedPaths = Array.from(pathSet).sort((a, b) => {
      const orderA = groupsMeta[a]?.order ?? 9999;
      const orderB = groupsMeta[b]?.order ?? 9999;
      if (orderA !== orderB) return orderA - orderB;
      return a.localeCompare(b);
    });

    const entries: GroupEntry[] = [];

    for (const p of sortedPaths) {
      const parts = p.split('/');
      const depth = parts.length - 1;
      const displayName = parts[parts.length - 1];
      const items = (sessionMap.get(p) ?? []).sort((a, b) => a.name.localeCompare(b.name));

      let isParentHidden = false;
      let ancestor = '';
      for (let i = 0; i < parts.length - 1; i++) {
        ancestor = ancestor ? `${ancestor}/${parts[i]}` : parts[i];
        if (collapsed[ancestor]) {
          isParentHidden = true;
          break;
        }
      }

      const prefix = `${p}/`;
      let totalCount = items.length;
      let onlineCount = items.filter((s) => statuses[s.id] === 'connected').length;

      for (const [otherKey, otherItems] of sessionMap.entries()) {
        if (otherKey.startsWith(prefix)) {
          totalCount += otherItems.length;
          onlineCount += otherItems.filter((s) => statuses[s.id] === 'connected').length;
        }
      }

      if (needle && totalCount === 0 && !displayName.toLowerCase().includes(needle)) {
        continue;
      }

      const resolvedColor = groupsMeta[p]?.color || resolveInheritedGroupColor(p, groupsMeta);

      entries.push({
        key: p,
        fullPath: p,
        displayName: groupsMeta[p]?.name || displayName,
        depth,
        metadata: groupsMeta[p],
        color: resolvedColor,
        items,
        totalCount,
        onlineCount,
        isParentHidden,
      });
    }

    const ungroupedItems = (sessionMap.get(UNGROUPED) ?? []).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    if (ungroupedItems.length > 0 || (needle === '' && pathSet.size === 0)) {
      entries.push({
        key: UNGROUPED,
        fullPath: '',
        displayName: t('sidebar.ungrouped'),
        depth: 0,
        items: ungroupedItems,
        totalCount: ungroupedItems.length,
        onlineCount: ungroupedItems.filter((s) => statuses[s.id] === 'connected').length,
        isParentHidden: false,
      });
    }

    return entries;
  }, [sessions, groupsMeta, query, statuses, collapsed, t]);

  const toggleGroup = (groupKey: string) => {
    setCollapsed((previous) => {
      const next = { ...previous, [groupKey]: !previous[groupKey] };
      try {
        localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Abaikan
      }
      return next;
    });
  };

  const expandAll = () => {
    const next: Record<string, boolean> = {};
    for (const entry of treeEntries) {
      next[entry.key] = false;
    }
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Abaikan
    }
  };

  const collapseAll = () => {
    const next: Record<string, boolean> = {};
    for (const entry of treeEntries) {
      next[entry.key] = true;
    }
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Abaikan
    }
  };

  const onServerDragStart = (event: DragEvent<HTMLDivElement>, sessionId: string) => {
    setDraggingId(sessionId);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/asproops-session', sessionId);
  };

  const onDropGroup = async (event: DragEvent<HTMLElement>, group: string) => {
    event.preventDefault();
    const sessionId = event.dataTransfer.getData('text/asproops-session') || draggingId;
    setDragTarget(null);
    setDraggingId(null);
    if (!sessionId) return;

    const nextGroup = group === UNGROUPED ? undefined : group;
    await onMoveGroup(sessionId, nextGroup);
    await reloadGroups();
    if (onRefresh) await onRefresh();
  };

  const handleMoveGroup = async (groupKey: string, direction: 'up' | 'down') => {
    const validKeys = treeEntries.filter((e) => e.key !== UNGROUPED).map((e) => e.key);
    const index = validKeys.indexOf(groupKey);
    if (index < 0) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= validKeys.length) return;

    const nextKeys = [...validKeys];
    const [moved] = nextKeys.splice(index, 1);
    nextKeys.splice(targetIndex, 0, moved);

    await window.ssh.serverGroups.reorder(nextKeys);
    await reloadGroups();
    if (onRefresh) await onRefresh();
  };

  const openAddGroup = () => {
    setGroupModal({
      open: true,
      mode: 'create',
      groupKey: '',
      name: '',
      color: '#c05cff',
      icon: 'folder',
    });
  };

  const openEditGroup = (entry: GroupEntry) => {
    setGroupModal({
      open: true,
      mode: 'edit',
      groupKey: entry.key,
      name: entry.metadata?.name || entry.key,
      color: entry.metadata?.color || '#c05cff',
      icon: entry.metadata?.icon || 'folder',
    });
  };

  const handleSaveModal = async (name: string, color: string, icon: string) => {
    if (!groupModal) return;
    const trimmed = name.trim();
    if (!trimmed) return;

    if (groupModal.mode === 'create') {
      await window.ssh.serverGroups.save(trimmed, { color, icon, name: trimmed });
    } else {
      if (trimmed !== groupModal.groupKey) {
        await window.ssh.serverGroups.rename(groupModal.groupKey, trimmed);
      }
      await window.ssh.serverGroups.save(trimmed, { color, icon, name: trimmed });
    }

    setGroupModal(null);
    await reloadGroups();
    if (onRefresh) await onRefresh();
  };

  const handleDeleteGroup = async () => {
    if (!groupModal || groupModal.mode !== 'edit') return;
    if (confirm(t('sidebar.deleteGroupConfirm', { name: groupModal.groupKey }))) {
      await window.ssh.serverGroups.delete(groupModal.groupKey);
      setGroupModal(null);
      await reloadGroups();
      if (onRefresh) await onRefresh();
    }
  };

  return (
    <aside className="aspro-server-explorer">
      <div className="aspro-sidebar-title">
        <div>
          <span>{t('sidebar.title')}</span>
          <small>{t('sidebar.savedServers', { count: sessions.length })}</small>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={expandAll}
            title={t('sidebar.expandAll')}
            aria-label={t('sidebar.expandAll')}
            className="aspro-mini-action"
          >
            ⊞
          </button>
          <button
            onClick={collapseAll}
            title={t('sidebar.collapseAll')}
            aria-label={t('sidebar.collapseAll')}
            className="aspro-mini-action"
          >
            ⊟
          </button>
          <button
            onClick={openAddGroup}
            title={t('sidebar.addGroup')}
            aria-label={t('sidebar.addGroup')}
            className="aspro-mini-action"
          >
            ＋
          </button>
          <button
            onClick={onImport}
            title="Import ~/.ssh/config"
            aria-label="Import ~/.ssh/config"
            className="aspro-mini-action"
          >
            ⇩
          </button>
        </div>
      </div>

      <div className="aspro-search">
        <span>⌕</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('sidebar.search')}
          aria-label={t('sidebar.search')}
        />
        <button onClick={onCreate} title={t('app.addServer')}>
          ＋
        </button>
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
        ) : treeEntries.length === 0 ? (
          <p className="p-6 text-center text-xs text-muted">
            {t('sidebar.noResult', { query })}
          </p>
        ) : (
          treeEntries.map((entry, index) => {
            if (entry.isParentHidden) return null;

            const isDropTarget = dragTarget === entry.key;
            const isCollapsed = Boolean(collapsed[entry.key]);
            const groupColor = entry.color;
            const groupIcon = resolveGroupIcon(
              entry.metadata?.icon,
              entry.key === UNGROUPED ? '▱' : '📁',
            );

            return (
              <section
                key={entry.key}
                className={`aspro-server-group ${isDropTarget ? 'drop-target' : ''}`}
                style={{
                  ...(entry.depth > 0 ? { marginLeft: `${entry.depth * 10}px` } : {}),
                  ...(groupColor
                    ? {
                        borderLeftWidth: '3px',
                        borderLeftColor: groupColor,
                        borderColor: `${groupColor}38`,
                        background: `linear-gradient(90deg, ${groupColor}14 0%, rgba(30, 11, 39, .32) 55%, rgba(10, 5, 15, .10) 100%)`,
                      }
                    : entry.depth > 0
                      ? {
                          borderLeftWidth: '2px',
                          borderLeftColor: 'rgba(105, 43, 130, 0.35)',
                        }
                      : {}),
                }}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setDragTarget(entry.key);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  setDragTarget(entry.key);
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    setDragTarget(null);
                  }
                }}
                onDrop={(event) => void onDropGroup(event, entry.key)}
              >
                <div
                  className="aspro-group-heading"
                  style={{
                    paddingLeft: `${Math.min(entry.depth * 6, 24)}px`,
                  }}
                >
                  <button
                    onClick={() => toggleGroup(entry.key)}
                    className="aspro-group-toggle"
                    title={isCollapsed ? t('sidebar.openGroup') : t('sidebar.closeGroup')}
                  >
                    <span className={isCollapsed ? '-rotate-90' : ''}>⌄</span>
                  </button>

                  <span
                    className="aspro-group-icon-badge"
                    style={
                      groupColor
                        ? {
                            backgroundColor: `${groupColor}24`,
                            borderColor: `${groupColor}66`,
                            boxShadow: `0 0 10px ${groupColor}2b`,
                          }
                        : undefined
                    }
                    title={entry.fullPath}
                  >
                    {groupIcon}
                  </span>

                  {groupColor && (
                    <span
                      className="aspro-group-color-dot"
                      style={{
                        backgroundColor: groupColor,
                        boxShadow: `0 0 6px ${groupColor}`,
                      }}
                      title={`Warna: ${groupColor}`}
                    />
                  )}

                  <button
                    onClick={() => toggleGroup(entry.key)}
                    className="aspro-group-name"
                    title={entry.fullPath || entry.displayName}
                  >
                    {entry.displayName}
                  </button>

                  {entry.onlineCount > 0 && (
                    <span className="aspro-group-online">
                      {t('sidebar.online', { count: entry.onlineCount })}
                    </span>
                  )}
                  <span
                    className="aspro-group-count"
                    style={
                      groupColor
                        ? {
                            backgroundColor: `${groupColor}22`,
                            color: groupColor,
                            borderColor: `${groupColor}55`,
                            borderWidth: '1px',
                            borderStyle: 'solid',
                          }
                        : undefined
                    }
                  >
                    {entry.totalCount}
                  </span>

                  {entry.key !== UNGROUPED && (
                    <div className="aspro-group-actions">
                      <button
                        type="button"
                        onClick={() => openEditGroup(entry)}
                        title={t('sidebar.editGroup')}
                        aria-label={t('sidebar.editGroup')}
                        className="aspro-mini-action"
                      >
                        ✎
                      </button>
                      {index > 0 && (
                        <button
                          type="button"
                          onClick={() => void handleMoveGroup(entry.key, 'up')}
                          title={t('sidebar.moveUp')}
                          aria-label={t('sidebar.moveUp')}
                          className="aspro-mini-action"
                        >
                          ↑
                        </button>
                      )}
                      {index < treeEntries.length - 2 && (
                        <button
                          type="button"
                          onClick={() => void handleMoveGroup(entry.key, 'down')}
                          title={t('sidebar.moveDown')}
                          aria-label={t('sidebar.moveDown')}
                          className="aspro-mini-action"
                        >
                          ↓
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {isDropTarget && draggingId && (
                  <div className="aspro-group-drop-message">
                    {t('sidebar.dropHere', { group: entry.displayName })}
                  </div>
                )}

                {!isCollapsed && entry.items.length === 0 && entry.totalCount === 0 && (
                  <div className="aspro-group-empty-hint">
                    {t('sidebar.emptyGroup')}
                  </div>
                )}

                {!isCollapsed &&
                  entry.items.map((session) => {
                    const status = statuses[session.id] ?? 'disconnected';
                    const style = STATUS_STYLE[status];
                    const isActive = session.id === activeId;
                    const isDragging = draggingId === session.id;
                    const avatarColor = session.color || groupColor;

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
                        style={{
                          paddingLeft: `${Math.min(entry.depth * 6 + 4, 30)}px`,
                          ...(groupColor && !session.color
                            ? {
                                borderLeftColor: `${groupColor}55`,
                              }
                            : {}),
                        }}
                      >
                        <span className="aspro-drag-grip" title={t('sidebar.dragToGroup')}>
                          ⋮⋮
                        </span>

                        <span
                          className="aspro-server-avatar"
                          style={
                            avatarColor
                              ? {
                                  color: avatarColor,
                                  borderColor: `${avatarColor}45`,
                                  background: `${avatarColor}1a`,
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
                          <IconButton label={t('sidebar.edit')} onClick={() => onEdit(session)}>
                            ✎
                          </IconButton>
                          <IconButton label={t('sidebar.delete')} onClick={() => onRemove(session.id)}>
                            ×
                          </IconButton>
                        </div>
                      </div>
                    );
                  })}
              </section>
            );
          })
        )}
      </div>

      <div className="flex gap-1 p-2">
        <button onClick={onCreate} className="aspro-add-group flex-1">
          ＋ {t('app.addServer')}
        </button>
        <button
          onClick={openAddGroup}
          className="aspro-add-group"
          title={t('sidebar.addGroup')}
          style={{ width: '42px', flex: '0 0 42px' }}
        >
          📁＋
        </button>
      </div>

      {groupModal && (
        <GroupModal
          state={groupModal}
          onSave={handleSaveModal}
          onDelete={groupModal.mode === 'edit' ? handleDeleteGroup : undefined}
          onClose={() => setGroupModal(null)}
        />
      )}
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
    <button onClick={onClick} title={label} aria-label={label} className="aspro-mini-action">
      {children}
    </button>
  );
}

function GroupModal({
  state,
  onSave,
  onDelete,
  onClose,
}: {
  state: GroupModalState;
  onSave: (name: string, color: string, icon: string) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(state.name);
  const [color, setColor] = useState(state.color);
  const [icon, setIcon] = useState(state.icon);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(name.trim(), color, icon);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="aspro-dialog w-full max-w-md p-5 text-fg shadow-2xl">
        <div className="mb-4 flex items-center justify-between border-b border-line pb-3">
          <h3 className="text-sm font-bold tracking-wide">
            {state.mode === 'create' ? t('sidebar.addGroup') : t('sidebar.editGroup')}
          </h3>
          <button
            onClick={onClose}
            className="text-muted hover:text-fg text-lg leading-none"
            aria-label="Tutup"
          >
            ×
          </button>
        </div>

        {error && (
          <div className="mb-3 rounded bg-coral/15 p-2 text-xs text-coral">
            {error}
          </div>
        )}

        {/* Live Preview Card */}
        <div className="mb-4">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-faint">
            Pratinjau Tampilan Grup
          </div>
          <div
            className="aspro-server-group p-2.5 transition-all"
            style={{
              borderLeftWidth: '3px',
              borderLeftColor: color,
              borderColor: `${color}38`,
              background: `linear-gradient(90deg, ${color}16 0%, rgba(30, 11, 39, .32) 55%, rgba(10, 5, 15, .10) 100%)`,
            }}
          >
            <div className="flex items-center gap-2">
              <span
                className="aspro-group-icon-badge"
                style={{
                  backgroundColor: `${color}24`,
                  borderColor: `${color}66`,
                  boxShadow: `0 0 10px ${color}2b`,
                }}
              >
                {resolveGroupIcon(icon)}
              </span>
              <span
                className="aspro-group-color-dot"
                style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}` }}
              />
              <span className="truncate text-xs font-bold text-fg">
                {name.trim() || 'Nama Grup'}
              </span>
              <span
                className="aspro-group-count ml-auto"
                style={{
                  backgroundColor: `${color}22`,
                  color: color,
                  borderColor: `${color}55`,
                  borderWidth: '1px',
                  borderStyle: 'solid',
                }}
              >
                3
              </span>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-dim">
              {t('sidebar.groupName')}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="mis. Produksi atau Cloud/AWS"
              className="w-full rounded border border-line bg-abyss px-3 py-2 text-sm text-fg focus:border-azure focus:outline-none"
              autoFocus
              required
            />
            <small className="mt-1 block text-[10px] text-faint">
              Gunakan tanda garis miring (mis. <code>Cloud/AWS</code>) untuk membuat sub-grup hierarkis.
            </small>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-dim">
              {t('sidebar.groupIcon')}
            </label>
            <div className="grid grid-cols-6 gap-2">
              {GROUP_ICON_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setIcon(preset.id)}
                  title={preset.label}
                  className={`flex flex-col items-center justify-center rounded border p-2 text-base transition ${
                    icon === preset.id
                      ? 'border-azure bg-azure/20 text-fg shadow-sm'
                      : 'border-line bg-surface text-faint hover:border-azure/40 hover:text-dim'
                  }`}
                >
                  <span>{preset.icon}</span>
                  <span className="mt-1 text-[9px] truncate w-full text-center">
                    {preset.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-dim">
              {t('sidebar.groupColor')}
            </label>
            <div className="flex flex-wrap items-center gap-2">
              {GROUP_COLOR_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => setColor(preset.value)}
                  title={preset.label}
                  className={`h-7 w-7 rounded-full border-2 transition ${
                    color === preset.value
                      ? 'scale-110 border-white shadow-md'
                      : 'border-transparent opacity-80 hover:scale-105 hover:opacity-100'
                  }`}
                  style={{ backgroundColor: preset.value }}
                />
              ))}
              <div className="flex items-center gap-1.5 ml-auto">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-7 w-7 cursor-pointer rounded border-0 bg-transparent p-0"
                  title="Warna Kustom"
                />
                <span className="font-mono text-xs text-muted">{color}</span>
              </div>
            </div>
          </div>

          <div className="mt-6 flex items-center justify-between border-t border-line pt-4">
            {onDelete ? (
              <button
                type="button"
                onClick={() => void onDelete()}
                className="text-xs text-coral hover:underline"
              >
                {t('sidebar.deleteGroup')}
              </button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded px-3 py-1.5 text-xs text-faint hover:text-dim"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={saving || !name.trim()}
                className="aspro-button aspro-button-primary compact"
              >
                {saving ? 'Menyimpan…' : 'Simpan'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
