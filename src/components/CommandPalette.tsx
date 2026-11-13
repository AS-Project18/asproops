import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type {
  CommandSnippet,
  ConnectionStatus,
  LocalProjectSummary,
  ServerGroupMetadata,
  SessionConfig,
} from '../shared/types';
import { useI18n, type MessageKey } from '../i18n';
import { useWorkspacePrefs } from '../workspacePrefs';
import { extractSnippetVariables, dispatchTerminalExec } from '../lib/snippetUtils';
import { SnippetVariableModal } from './SnippetVariableModal';

export interface CommandPaletteProps {
  sessions: SessionConfig[];
  statuses: Record<string, ConnectionStatus>;
  onSelectSession: (sessionId: string) => void;
  onSelectLocalProject?: (project: LocalProjectSummary) => void;
  onNewSession?: () => void;
  onOpenFolderPicker?: () => void;
  onOpenSettings?: () => void;
  onExportBackup?: () => void;
  onImportBackup?: () => void;
  onCloseActiveTab?: () => void;
  appLockEnabled?: boolean;
  onClose: () => void;
}

type PaletteScope = 'all' | 'server' | 'project' | 'action';

interface PaletteItem {
  id: string;
  kind: 'server' | 'project' | 'action';
  title: string;
  subtitle?: string;
  badge?: string;
  badgeColor?: string;
  icon?: string;
  color?: string;
  status?: ConnectionStatus;
  groupMeta?: ServerGroupMetadata;
  shortcutHint?: string;
  onSelect: () => void;
}

const STATUS_DOT: Record<ConnectionStatus, string> = {
  disconnected: 'bg-ghost',
  connecting: 'bg-amber animate-pulse',
  connected: 'bg-mint',
  reconnecting: 'bg-amber animate-pulse',
  error: 'bg-coral',
};

export function CommandPalette({
  sessions,
  statuses,
  onSelectSession,
  onSelectLocalProject,
  onNewSession,
  onOpenFolderPicker,
  onOpenSettings,
  onExportBackup,
  onImportBackup,
  onCloseActiveTab,
  appLockEnabled,
  onClose,
}: CommandPaletteProps) {
  const { t, language, setLanguage } = useI18n();
  const { prefs: wsPrefs, setPrefs: setWsPrefs } = useWorkspacePrefs();

  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<PaletteScope>('all');
  const [highlighted, setHighlighted] = useState(0);

  const [localProjects, setLocalProjects] = useState<LocalProjectSummary[]>([]);
  const [groupsMeta, setGroupsMeta] = useState<Record<string, ServerGroupMetadata>>({});
  const [snippets, setSnippets] = useState<CommandSnippet[]>([]);
  const [selectedSnippetForVar, setSelectedSnippetForVar] = useState<CommandSnippet | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    void (async () => {
      try {
        const [projects, meta, snips] = await Promise.all([
          window.ssh.localProjects.list().catch(() => []),
          window.ssh.serverGroups.list().catch(() => ({})),
          window.ssh.snippets.list().catch(() => []),
        ]);
        setLocalProjects(projects);
        setGroupsMeta(meta || {});
        setSnippets(snips);
      } catch {
        // App mungkin terkunci atau belum siap
      }
    })();
  }, []);

  const items = useMemo<PaletteItem[]>(() => {
    const list: PaletteItem[] = [];

    // 1. Server SSH
    for (const session of sessions) {
      const gMeta = session.group ? groupsMeta[session.group] : undefined;
      list.push({
        id: `server-${session.id}`,
        kind: 'server',
        title: session.name,
        subtitle: `${session.username}@${session.host}${session.port !== 22 ? `:${session.port}` : ''}${
          session.group ? ` • ${session.group}` : ''
        }`,
        badge: 'SSH',
        color: session.color,
        status: statuses[session.id] ?? 'disconnected',
        groupMeta: gMeta,
        onSelect: () => {
          onSelectSession(session.id);
          onClose();
        },
      });
    }

    // 2. Project Lokal
    for (const project of localProjects) {
      list.push({
        id: `project-${project.id}`,
        kind: 'project',
        title: project.name,
        subtitle: project.path,
        badge: 'Local',
        icon: '📁',
        onSelect: () => {
          if (onSelectLocalProject) onSelectLocalProject(project);
          onClose();
        },
      });
    }

    // 3. Aksi / Perintah Cepat
    if (onNewSession) {
      list.push({
        id: 'action-new-server',
        kind: 'action',
        title: t('palette.actionNewServer'),
        subtitle: t('palette.actionNewServerDesc'),
        badge: t('palette.actions'),
        icon: '➕',
        onSelect: () => {
          onNewSession();
          onClose();
        },
      });
    }

    if (onOpenFolderPicker) {
      list.push({
        id: 'action-open-folder',
        kind: 'action',
        title: t('palette.actionOpenFolder'),
        subtitle: t('palette.actionOpenFolderDesc'),
        badge: t('palette.actions'),
        icon: '📂',
        onSelect: () => {
          onOpenFolderPicker();
          onClose();
        },
      });
    }

    if (onOpenSettings) {
      list.push({
        id: 'action-settings',
        kind: 'action',
        title: t('palette.actionSettings'),
        subtitle: t('palette.actionSettingsDesc'),
        badge: t('palette.actions'),
        icon: '⚙️',
        shortcutHint: 'Ctrl + ,',
        onSelect: () => {
          onOpenSettings();
          onClose();
        },
      });
    }

    if (onExportBackup) {
      list.push({
        id: 'action-export-backup',
        kind: 'action',
        title: t('palette.actionExportBackup'),
        subtitle: t('palette.actionExportBackupDesc'),
        badge: t('palette.actions'),
        icon: '💾',
        onSelect: () => {
          onExportBackup();
          onClose();
        },
      });
    }

    if (onImportBackup) {
      list.push({
        id: 'action-import-backup',
        kind: 'action',
        title: t('palette.actionImportBackup'),
        subtitle: t('palette.actionImportBackupDesc'),
        badge: t('palette.actions'),
        icon: '📥',
        onSelect: () => {
          onImportBackup();
          onClose();
        },
      });
    }

    list.push({
      id: 'action-switch-lang',
      kind: 'action',
      title: t('palette.actionSwitchLang'),
      subtitle: `${t('palette.actionSwitchLangDesc')} (${language === 'id' ? 'Indonesia → English' : 'English → Indonesia'})`,
      badge: t('palette.actions'),
      icon: '🌐',
      onSelect: () => {
        setLanguage(language === 'id' ? 'en' : 'id');
        onClose();
      },
    });

    list.push({
      id: 'action-toggle-density',
      kind: 'action',
      title: t('palette.actionToggleDensity'),
      subtitle: `${t('palette.actionToggleDensityDesc')} (${
        wsPrefs.uiDensity === 'compact' ? 'Compact → Comfortable' : 'Comfortable → Compact'
      })`,
      badge: t('palette.actions'),
      icon: '📏',
      onSelect: () => {
        setWsPrefs({ uiDensity: wsPrefs.uiDensity === 'compact' ? 'comfortable' : 'compact' });
        onClose();
      },
    });

    if (appLockEnabled) {
      list.push({
        id: 'action-lock-app',
        kind: 'action',
        title: t('palette.actionLockApp'),
        subtitle: t('palette.actionLockAppDesc'),
        badge: t('palette.actions'),
        icon: '🔒',
        onSelect: () => {
          void window.ssh.appLock.relock();
          onClose();
        },
      });
    }

    if (onCloseActiveTab) {
      list.push({
        id: 'action-close-tab',
        kind: 'action',
        title: t('palette.actionCloseTab'),
        subtitle: t('palette.actionCloseTabDesc'),
        badge: t('palette.actions'),
        icon: '✕',
        onSelect: () => {
          onCloseActiveTab();
          onClose();
        },
      });
    }

    list.push({
      id: 'action-split-vertical',
      kind: 'action',
      title: t('terminal.splitVertical'),
      subtitle: 'Bagi terminal aktif menjadi dua panel vertikal (kiri & kanan)',
      badge: t('palette.actions'),
      icon: '◫',
      shortcutHint: 'Ctrl + Shift + E',
      onSelect: () => {
        window.dispatchEvent(new CustomEvent('asproops:split-vertical'));
        onClose();
      },
    });

    list.push({
      id: 'action-open-tunnels',
      kind: 'action',
      title: t('tunnel.title'),
      subtitle: t('tunnel.subtitle'),
      badge: t('palette.actions'),
      icon: '⇄',
      onSelect: () => {
        window.dispatchEvent(new CustomEvent('asproops:open-tunnels'));
        onClose();
      },
    });

    list.push({
      id: 'action-ssh-keys',
      kind: 'action',
      title: t('sshKey.title'),
      subtitle: t('sshKey.subtitle'),
      badge: t('palette.actions'),
      icon: '🔑',
      onSelect: () => {
        window.dispatchEvent(new CustomEvent('asproops:open-ssh-keys'));
        onClose();
      },
    });

    list.push({
      id: 'action-split-horizontal',
      kind: 'action',
      title: t('terminal.splitHorizontal'),
      subtitle: 'Bagi terminal aktif menjadi dua panel horizontal (atas & bawah)',
      badge: t('palette.actions'),
      icon: '⬒',
      shortcutHint: 'Ctrl + Shift + O',
      onSelect: () => {
        window.dispatchEvent(new CustomEvent('asproops:split-horizontal'));
        onClose();
      },
    });

    list.push({
      id: 'action-close-split',
      kind: 'action',
      title: t('terminal.closeSplit'),
      subtitle: 'Tutup panel kedua dan kembalikan ke tampilan terminal tunggal',
      badge: t('palette.actions'),
      icon: '✕',
      shortcutHint: 'Ctrl + Shift + W',
      onSelect: () => {
        window.dispatchEvent(new CustomEvent('asproops:close-split'));
        onClose();
      },
    });

    list.push({
      id: 'action-toggle-snippets',
      kind: 'action',
      title: wsPrefs.showSnippetsBar ? t('snippets.hideBar') : t('snippets.showBar'),
      subtitle: t('snippets.toggleBarDesc'),
      badge: t('palette.actions'),
      icon: '⚡',
      onSelect: () => {
        setWsPrefs({ showSnippetsBar: !wsPrefs.showSnippetsBar });
        onClose();
      },
    });

    // 4. Quick Snippets Perintah
    for (const snippet of snippets) {
      list.push({
        id: `snippet-${snippet.id}`,
        kind: 'action',
        title: snippet.name,
        subtitle: `$ ${snippet.command}${snippet.description ? ` • ${snippet.description}` : ''}`,
        badge: snippet.category,
        icon: '⚡',
        onSelect: () => {
          const vars = extractSnippetVariables(snippet.command);
          if (vars.length > 0) {
            setSelectedSnippetForVar(snippet);
          } else {
            dispatchTerminalExec(snippet.command, true);
            onClose();
          }
        },
      });
    }

    return list;
  }, [
    sessions,
    localProjects,
    groupsMeta,
    snippets,
    statuses,
    language,
    wsPrefs.uiDensity,
    wsPrefs.showSnippetsBar,
    appLockEnabled,
    t,
    onSelectSession,
    onSelectLocalProject,
    onNewSession,
    onOpenFolderPicker,
    onOpenSettings,
    onExportBackup,
    onImportBackup,
    onCloseActiveTab,
    onClose,
    setLanguage,
    setWsPrefs,
  ]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return items.filter((item) => {
      if (scope !== 'all' && item.kind !== scope) return false;
      if (!needle) return true;

      const matchTitle = item.title.toLowerCase().includes(needle);
      const matchSubtitle = item.subtitle?.toLowerCase().includes(needle) ?? false;
      const matchBadge = item.badge?.toLowerCase().includes(needle) ?? false;
      return matchTitle || matchSubtitle || matchBadge;
    });
  }, [items, scope, query]);

  useEffect(() => {
    setHighlighted(0);
  }, [query, scope]);

  useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    const activeEl = container.children[highlighted] as HTMLElement | undefined;
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }, [highlighted]);

  const scopes: { id: PaletteScope; labelKey: MessageKey; icon: string }[] = [
    { id: 'all', labelKey: 'palette.all', icon: '⚡' },
    { id: 'server', labelKey: 'palette.servers', icon: '⌁' },
    { id: 'project', labelKey: 'palette.projects', icon: '💻' },
    { id: 'action', labelKey: 'palette.actions', icon: '⚙️' },
  ];

  const handleKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === 'Escape') {
      onClose();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted((h) => Math.min(h + 1, Math.max(0, filtered.length - 1)));
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
      if (picked) picked.onSelect();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      const currentIndex = scopes.findIndex((s) => s.id === scope);
      const nextIndex = event.shiftKey
        ? (currentIndex - 1 + scopes.length) % scopes.length
        : (currentIndex + 1) % scopes.length;
      setScope(scopes[nextIndex].id);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[150] flex items-start justify-center bg-black/75 p-2.5 sm:p-4 pt-[5vh] sm:pt-[10vh] backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-[96vw] max-w-xl overflow-hidden rounded-xl border border-line bg-surface shadow-2xl transition-all"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('app.quickConnect')}
      >
        {/* Search Input Bar */}
        <div className="flex items-center gap-2.5 border-b border-line/60 bg-raised px-4 py-3">
          <span className="text-base text-azure">⚡</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('palette.placeholder')}
            aria-label={t('palette.placeholder')}
            spellCheck={false}
            className="min-w-0 flex-1 border-0 bg-transparent text-sm text-fg outline-none placeholder-faint"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="text-xs text-faint hover:text-fg"
              aria-label="Hapus teks"
            >
              ✕
            </button>
          )}
          <span className="rounded border border-line/80 bg-abyss px-1.5 py-0.5 text-[10px] font-mono text-faint">
            Esc
          </span>
        </div>

        {/* Scope Filter Pills */}
        <div className="flex items-center gap-1.5 border-b border-line/40 bg-surface/50 px-3 py-1.5 text-xs">
          {scopes.map((s) => {
            const active = scope === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setScope(s.id)}
                className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  active
                    ? 'bg-azure text-white shadow-sm'
                    : 'text-muted hover:bg-hover hover:text-fg'
                }`}
              >
                <span>{s.icon}</span>
                <span>{t(s.labelKey)}</span>
              </button>
            );
          })}
          <span className="ml-auto text-[10px] text-faint">
            {filtered.length} {t('palette.results')}
          </span>
        </div>

        {/* Results List */}
        <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <div className="py-10 text-center text-xs text-muted">
              {query ? t('palette.noResults', { query }) : t('palette.empty')}
            </div>
          ) : (
            filtered.map((item, index) => {
              const isSelected = index === highlighted;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={item.onSelect}
                  onMouseEnter={() => setHighlighted(index)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors focus:outline-none ${
                    isSelected ? 'bg-active' : 'hover:bg-hover'
                  }`}
                >
                  {/* Left Avatar / Icon */}
                  {item.kind === 'server' ? (
                    <span
                      className="aspro-server-avatar shrink-0"
                      style={
                        item.color
                          ? {
                              color: item.color,
                              borderColor: `${item.color}55`,
                              background: `${item.color}1f`,
                            }
                          : undefined
                      }
                    >
                      {item.title.trim().charAt(0).toUpperCase() || 'S'}
                    </span>
                  ) : (
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line/60 bg-abyss text-sm">
                      {item.icon || '•'}
                    </span>
                  )}

                  {/* Title & Subtitle */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {item.status && (
                        <span
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                            STATUS_DOT[item.status]
                          }`}
                        />
                      )}
                      <span className="truncate text-sm font-medium text-dim">
                        {item.title}
                      </span>

                      {/* Group badge with custom color and icon if available */}
                      {item.groupMeta && (
                        <span
                          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-normal"
                          style={{
                            color: item.groupMeta.color || 'var(--color-dim)',
                            backgroundColor: item.groupMeta.color
                              ? `${item.groupMeta.color}1a`
                              : 'rgba(255, 255, 255, 0.06)',
                            border: `1px solid ${
                              item.groupMeta.color
                                ? `${item.groupMeta.color}35`
                                : 'transparent'
                            }`,
                          }}
                        >
                          {item.groupMeta.icon && <span>{item.groupMeta.icon}</span>}
                          <span>{item.groupMeta.name || item.groupMeta.id}</span>
                        </span>
                      )}
                    </div>

                    {item.subtitle && (
                      <div className="mt-0.5 truncate font-mono text-[11px] text-faint">
                        {item.subtitle}
                      </div>
                    )}
                  </div>

                  {/* Right Badge or Shortcut */}
                  <div className="shrink-0 text-right">
                    {item.shortcutHint ? (
                      <span className="rounded border border-line bg-abyss px-1.5 py-0.5 font-mono text-[10px] text-faint">
                        {item.shortcutHint}
                      </span>
                    ) : item.badge ? (
                      <span className="rounded bg-abyss px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted">
                        {item.badge}
                      </span>
                    ) : null}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Footer Navigation Hints */}
        <div className="flex items-center justify-between border-t border-line/50 bg-raised px-4 py-2 text-[10px] text-faint">
          <div className="flex items-center gap-3">
            <span>↑↓ {t('palette.navigate')}</span>
            <span>Enter {t('palette.select')}</span>
            <span>Tab {t('palette.switchTab')}</span>
          </div>
          <span>Esc {t('settings.close')}</span>
        </div>
      </div>

      {selectedSnippetForVar && (
        <SnippetVariableModal
          snippet={selectedSnippetForVar}
          onExecute={(cmd, enter) => {
            dispatchTerminalExec(cmd, enter);
            onClose();
          }}
          onClose={() => setSelectedSnippetForVar(null)}
        />
      )}
    </div>
  );
}
