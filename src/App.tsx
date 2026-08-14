import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import asproIcon from './assets/asprossh-icon.png';
import { SessionSidebar } from './components/SessionSidebar';
import { SessionForm } from './components/SessionForm';
import { HostKeyDialog, useHostKeyPrompts } from './components/HostKeyDialog';
import { ImportSshConfig } from './components/ImportSshConfig';
import { TerminalTabs } from './components/TerminalTabs';
import { FileBrowser } from './components/FileBrowser';
import { MonitorPanel } from './components/MonitorPanel';
import { LocalTerminalPanel } from './components/LocalTerminalPanel';
import { LocalTerminalView } from './components/LocalTerminalView';
import { SettingsDialog } from './components/SettingsDialog';
import { useI18n } from './i18n';
import { useSessions } from './hooks/useSessions';
import { formatBytes } from './lib/format';
import type { LocalTerminalProfile, LocalTerminalWorkspace, MonitorSnapshot, SessionConfig } from './shared/types';

type FormState = { open: false } | { open: true; editing: SessionConfig | null };
type LeftMode = 'servers' | 'local' | 'files' | 'monitor';

export default function App() {
  const { t } = useI18n();
  const { sessions, statuses, errors, loading, connect, disconnect, save, remove, refresh } =
    useSessions();
  const { prompt, respond } = useHostKeyPrompts();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeLocalId, setActiveLocalId] = useState<string | null>(null);
  const [localProfiles, setLocalProfiles] = useState<LocalTerminalProfile[]>([]);
  const [localProfilesLoading, setLocalProfilesLoading] = useState(true);
  const [localWorkspaces, setLocalWorkspaces] = useState<LocalTerminalWorkspace[]>([]);
  const [leftMode, setLeftMode] = useState<LeftMode>('servers');
  const [leftWidth, setLeftWidth] = useState(330);
  const [resizingLeft, setResizingLeft] = useState(false);
  const [monitorSnapshot, setMonitorSnapshot] = useState<MonitorSnapshot | null>(null);
  const [form, setForm] = useState<FormState>({ open: false });
  const [pendingDelete, setPendingDelete] = useState<SessionConfig | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [liveSessions, setLiveSessions] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    setLiveSessions((prev) => {
      const ready = Object.entries(statuses)
        .filter(([, status]) => status === 'connected')
        .map(([id]) => id);

      const kept = prev.filter((id) => statuses[id] && statuses[id] !== 'disconnected');
      const next = [...new Set([...kept, ...ready])];

      return next.length === prev.length && next.every((id, i) => id === prev[i]) ? prev : next;
    });
  }, [statuses]);


  const refreshLocalProfiles = async () => {
    setLocalProfilesLoading(true);
    try {
      setLocalProfiles(await window.ssh.local.list());
    } finally {
      setLocalProfilesLoading(false);
    }
  };

  useEffect(() => {
    void refreshLocalProfiles();
  }, []);

  useEffect(() => {
    setMonitorSnapshot(null);
    if (!activeId) return;

    return window.ssh.monitor.onSnapshot((payload) => {
      if (payload.sessionId === activeId) {
        setMonitorSnapshot(payload.snapshot);
      }
    });
  }, [activeId]);

  const activeStatus = activeId ? (statuses[activeId] ?? 'disconnected') : null;
  const activeSession = sessions.find((s) => s.id === activeId) ?? null;
  const activeLocal =
    localWorkspaces.find((workspace) => workspace.id === activeLocalId) ?? null;
  const connectedCount = useMemo(
    () => Object.values(statuses).filter((status) => status === 'connected').length,
    [statuses],
  );

  const handleSelectRemote = (id: string) => {
    setActiveLocalId(null);
    setActiveId(id);
  };

  const activateRemoteWorkspace = (id: string) => {
    setActiveLocalId(null);
    setActiveId(id);
  };

  const activateLocalWorkspace = (workspaceId: string) => {
    setActiveLocalId(workspaceId);
  };

  const handleConnect = (id: string) => {
    setActiveLocalId(null);
    setActiveId(id);
    void connect(id);
  };

  const moveServerToGroup = async (sessionId: string, group?: string) => {
    await window.ssh.sessions.update(sessionId, { group });
    await refresh();
  };

  const openLocalTerminal = (profile: LocalTerminalProfile) => {
    const workspace: LocalTerminalWorkspace = {
      id: crypto.randomUUID(),
      profile,
      createdAt: Date.now(),
    };

    setLocalWorkspaces((current) => [...current, workspace]);
    setActiveLocalId(workspace.id);
    setLeftMode('local');
  };

  const closeLocalTerminal = (workspaceId: string) => {
    const remaining = localWorkspaces.filter((item) => item.id !== workspaceId);
    setLocalWorkspaces(remaining);

    if (activeLocalId === workspaceId) {
      const nextLocal = remaining.at(-1);
      if (nextLocal) {
        setActiveLocalId(nextLocal.id);
      } else {
        setActiveLocalId(null);
        const lastRemote = liveSessions.at(-1);
        if (lastRemote) setActiveId(lastRemote);
      }
    }
  };

  const startLeftResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    setResizingLeft(true);

    const handleMove = (moveEvent: PointerEvent) => {
      // 10px outer padding + 78px navigation rail + 9px gap.
      const proposed = moveEvent.clientX - 97;
      setLeftWidth(Math.max(260, Math.min(680, proposed)));
    };

    const handleUp = () => {
      setResizingLeft(false);
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  };

  const memPercent =
    monitorSnapshot && monitorSnapshot.mem.totalBytes > 0
      ? (monitorSnapshot.mem.usedBytes / monitorSnapshot.mem.totalBytes) * 100
      : null;

  const rootDisk =
    monitorSnapshot?.disks.find((disk) => disk.mount === '/') ?? monitorSnapshot?.disks[0] ?? null;

  const diskPercent =
    rootDisk && rootDisk.totalBytes > 0
      ? (rootDisk.usedBytes / rootDisk.totalBytes) * 100
      : null;


  return (
    <div className="aspro-app h-screen overflow-hidden bg-abyss text-fg">
      <header className="aspro-topbar">
        <div className="aspro-brand">
          <img src={asproIcon} alt="" className="aspro-brand-icon" />
          <div>
            <div className="aspro-brand-title">
              <strong>ASPro</strong><span>SSH</span>
            </div>
            <div className="aspro-brand-subtitle">{t('app.tagline')}</div>
          </div>
        </div>

        <div className="aspro-quick">
          <span className="aspro-bolt">ϟ</span>
          <span className="truncate">{t('app.quickConnect')}</span>
          <span className="ml-auto text-[10px] text-faint">Ctrl + K</span>
        </div>

        <div className="aspro-top-actions">
          <div className="hidden text-right xl:block">
            <div className="text-[10px] uppercase tracking-[0.18em] text-faint">{t('app.activeServers')}</div>
            <div className="text-xs text-dim">{connectedCount} {t('app.of')} {sessions.length}</div>
          </div>
          <button
            onClick={() => setImporting(true)}
            className="aspro-button aspro-button-secondary"
          >
            ⇩ {t('app.importSsh')}
          </button>
          <button
            onClick={() => setForm({ open: true, editing: null })}
            className="aspro-button aspro-button-primary"
          >
            ＋ {t('app.addServer')}
          </button>
        </div>
      </header>

      <div
        className={`aspro-workspace ${resizingLeft ? 'is-resizing' : ''}`}
        style={{
          gridTemplateColumns: `78px ${leftWidth}px minmax(420px, 1fr)`,
        }}
      >
        <aside className="aspro-rail" aria-label={t('nav.connections')}>
          <RailButton
            active={leftMode === 'servers'}
            icon="▦"
            label={t('nav.connections')}
            onClick={() => setLeftMode('servers')}
          />
          <RailButton
            active={leftMode === 'local'}
            icon=">_"
            label={t('nav.local')}
            onClick={() => setLeftMode('local')}
          />
          <RailButton
            active={leftMode === 'files'}
            icon="□"
            label={t('nav.sftp')}
            onClick={() => setLeftMode('files')}
          />
          <RailButton
            active={leftMode === 'monitor'}
            icon="⌁"
            label={t('nav.monitor')}
            onClick={() => setLeftMode('monitor')}
          />
          <div className="flex-1" />
          <RailButton icon="⚙" label={t('nav.settings')} onClick={() => setSettingsOpen(true)} />
        </aside>

        <aside className="aspro-left-dock">
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <div
              className={
                leftMode === 'servers'
                  ? 'absolute inset-0'
                  : 'pointer-events-none invisible absolute inset-0'
              }
            >
              <SessionSidebar
                sessions={sessions}
                statuses={statuses}
                errors={errors}
                activeId={activeId}
                onSelect={handleSelectRemote}
                onConnect={handleConnect}
                onDisconnect={(id) => void disconnect(id)}
                onEdit={(session) => setForm({ open: true, editing: session })}
                onRemove={(id) => setPendingDelete(sessions.find((s) => s.id === id) ?? null)}
                onMoveGroup={moveServerToGroup}
                onCreate={() => setForm({ open: true, editing: null })}
                onImport={() => setImporting(true)}
              />
            </div>

            <div
              className={
                leftMode === 'local'
                  ? 'absolute inset-0'
                  : 'pointer-events-none invisible absolute inset-0'
              }
            >
              <LocalTerminalPanel
                profiles={localProfiles}
                loading={localProfilesLoading}
                onOpen={openLocalTerminal}
                onRefresh={() => void refreshLocalProfiles()}
              />
            </div>

            {activeSession && activeStatus === 'connected' ? (
              <>
                <div
                  className={
                    leftMode === 'files'
                      ? 'absolute inset-0'
                      : 'pointer-events-none invisible absolute inset-0'
                  }
                >
                  <FileBrowser sessionId={activeSession.id} />
                </div>

                <div
                  className={
                    leftMode === 'monitor'
                      ? 'absolute inset-0'
                      : 'pointer-events-none invisible absolute inset-0'
                  }
                >
                  <MonitorPanel sessionId={activeSession.id} />
                </div>
              </>
            ) : (
              (leftMode === 'files' || leftMode === 'monitor') && (
                <div className="aspro-side-placeholder absolute inset-0">
                  <div className="aspro-side-placeholder-icon">
                    {leftMode === 'files' ? '□' : '⌁'}
                  </div>
                  <strong>{leftMode === 'files' ? t('placeholder.sftp') : t('placeholder.monitor')}</strong>
                  <span>{t('placeholder.connectRequired')}</span>
                </div>
              )
            )}
          </div>

          <div
            className="aspro-left-resize-handle"
            onPointerDown={startLeftResize}
            title="Geser untuk mengubah lebar sidebar"
          />
        </aside>

        <main className="aspro-center">
          <div className="aspro-workspace-tabs">
            {liveSessions.map((id) => {
              const session = sessions.find((item) => item.id === id);
              if (!session) return null;
              const isActive = !activeLocalId && activeId === id;

              return (
                <button
                  key={`ssh:${id}`}
                  className={`aspro-workspace-tab ${isActive ? 'active' : ''}`}
                  onClick={() => activateRemoteWorkspace(id)}
                  title={`${session.username}@${session.host}:${session.port}`}
                >
                  <span className="aspro-workspace-tab-dot ssh" />
                  <span className="truncate">{session.name}</span>
                  <span className="aspro-workspace-tab-kind">SSH</span>
                </button>
              );
            })}

            {localWorkspaces.map((workspace) => {
              const isActive = activeLocalId === workspace.id;

              return (
                <button
                  key={`local:${workspace.id}`}
                  className={`aspro-workspace-tab ${isActive ? 'active' : ''}`}
                  onClick={() => activateLocalWorkspace(workspace.id)}
                  title={workspace.profile.command}
                >
                  <span
                    className={`aspro-workspace-tab-dot ${
                      workspace.profile.kind === 'wsl' ? 'wsl' : 'local'
                    }`}
                  />
                  <span className="truncate">
                    {workspace.profile.kind === 'wsl'
                      ? `WSL · ${workspace.profile.name}`
                      : workspace.profile.name}
                  </span>
                  <span className="aspro-workspace-tab-kind">
                    {workspace.profile.kind === 'wsl' ? 'WSL' : 'LOCAL'}
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    className="aspro-workspace-tab-close"
                    onClick={(event) => {
                      event.stopPropagation();
                      closeLocalTerminal(workspace.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        event.stopPropagation();
                        closeLocalTerminal(workspace.id);
                      }
                    }}
                    title="Tutup terminal lokal"
                  >
                    ×
                  </span>
                </button>
              );
            })}

            {liveSessions.length === 0 && localWorkspaces.length === 0 && (
              <span className="aspro-workspace-tabs-empty">{t('workspace.none')}</span>
            )}
          </div>

          <div className="aspro-session-header">
            {activeLocal ? (
              <>
                <div className="aspro-live-dot online" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-fg">
                    {activeLocal.profile.kind === 'wsl'
                      ? `WSL · ${activeLocal.profile.name}`
                      : activeLocal.profile.name}
                  </div>
                  <div className="truncate font-mono text-[10px] text-faint">
                    {t('workspace.localTerminal')} · {activeLocal.profile.command}
                  </div>
                </div>
                <span className="aspro-local-chip">
                  {activeLocal.profile.kind === 'wsl' ? 'WSL' : 'LOCAL'}
                </span>
                <span className="aspro-status-chip connected">{t('workspace.active')}</span>

                <div className="ml-auto">
                  <button
                    onClick={() => closeLocalTerminal(activeLocal.id)}
                    className="aspro-button aspro-button-danger"
                  >
                    Tutup
                  </button>
                </div>
              </>
            ) : activeSession ? (
              <>
                <div
                  className={`aspro-live-dot ${
                    activeStatus === 'connected'
                      ? 'online'
                      : activeStatus === 'connecting' || activeStatus === 'reconnecting'
                        ? 'pending'
                        : activeStatus === 'error'
                          ? 'error'
                          : ''
                  }`}
                />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-fg">{activeSession.name}</div>
                  <div className="truncate font-mono text-[10px] text-faint">
                    {activeSession.username}@{activeSession.host}:{activeSession.port}
                  </div>
                </div>
                <span className="aspro-ssh-chip">🔒 SSH</span>
                <span
                  className={`aspro-status-chip ${
                    activeStatus === 'connected'
                      ? 'connected'
                      : activeStatus === 'error'
                        ? 'failed'
                        : activeStatus === 'connecting' || activeStatus === 'reconnecting'
                          ? 'connecting'
                          : ''
                  }`}
                >
                  {activeStatus === 'connected'
                    ? t('workspace.connected')
                    : activeStatus === 'connecting'
                      ? t('workspace.connecting')
                      : activeStatus === 'reconnecting'
                        ? t('workspace.reconnecting')
                        : activeStatus === 'error'
                          ? t('workspace.failed')
                          : t('workspace.disconnected')}
                </span>

                <div className="ml-auto">
                  {activeStatus === 'connected' || activeStatus === 'reconnecting' ? (
                    <button
                      onClick={() => void disconnect(activeSession.id)}
                      className="aspro-button aspro-button-danger"
                    >
                      {t('workspace.disconnect')}
                    </button>
                  ) : (
                    <button
                      onClick={() => handleConnect(activeSession.id)}
                      className="aspro-button aspro-button-primary compact"
                    >
                      ▶ {t('workspace.connect')}
                    </button>
                  )}
                </div>
              </>
            ) : (
              <div>
                <div className="text-sm font-semibold text-fg">Workspace</div>
                <div className="text-[10px] text-faint">
                  {t('workspace.choose')}
                </div>
              </div>
            )}
          </div>

          <div className="aspro-terminal-card">
            {liveSessions.map((id) => (
              <div
                key={id}
                className={!activeLocalId && statuses[id] === 'connected' && id === activeId ? 'h-full' : 'hidden'}
              >
                <TerminalTabs
                  sessionId={id}
                  visible={!activeLocalId && statuses[id] === 'connected' && id === activeId}
                />
              </div>
            ))}

            {localWorkspaces.map((workspace) => (
              <div
                key={workspace.id}
                className={workspace.id === activeLocalId ? 'h-full' : 'hidden'}
              >
                <LocalTerminalView
                  workspaceId={workspace.id}
                  profile={workspace.profile}
                  active={workspace.id === activeLocalId}
                  onExit={() => closeLocalTerminal(workspace.id)}
                />
              </div>
            ))}

            {activeLocal ? null : loading ? (
              <WorkspacePlaceholder
                icon="⌁"
                title={t('workspace.loadingServers')}
                detail={t('workspace.readingConfig')}
              />
            ) : !activeSession ? (
              <WorkspacePlaceholder
                icon="›_"
                title={t('workspace.noServerSelected')}
                detail={t('workspace.selectServer')}
              />
            ) : activeStatus === 'connecting' || activeStatus === 'reconnecting' ? (
              <WorkspacePlaceholder
                icon="ϟ"
                title={t('workspace.connectingTo', { name: activeSession.name })}
                detail={`${activeSession.username}@${activeSession.host}:${activeSession.port}`}
              />
            ) : activeStatus !== 'connected' ? (
              <WorkspacePlaceholder
                icon={activeStatus === 'error' ? '!' : '›_'}
                title={activeStatus === 'error' ? t('workspace.connectionFailed') : t('workspace.serverNotConnected')}
                detail={errors[activeSession.id] ?? t('workspace.clickConnect')}
                action={
                  <button
                    onClick={() => handleConnect(activeSession.id)}
                    className="aspro-button aspro-button-primary mt-3"
                  >
                    ▶ {t('workspace.connect')} SSH
                  </button>
                }
              />
            ) : null}
          </div>

          <div className="aspro-terminal-footer">
            <span className="aspro-footer-active">▣ {t('status.terminal')}</span>
            <span>{t('workspace.newTerminal')}</span>
            <span className="ml-auto">xterm.js · SSH2</span>
          </div>
        </main>

      </div>

      <footer className="aspro-statusbar">
        <span className="text-orange">◇</span>
        {activeLocal ? (
          <>
            <span className="text-mint">
              ● {activeLocal.profile.kind === 'wsl' ? `WSL · ${activeLocal.profile.name}` : activeLocal.profile.name}
            </span>
            <span className="aspro-divider" />
            <span>LOCAL</span>
            <span className="aspro-divider" />
            <span className="font-mono">{activeLocal.profile.command}</span>
          </>
        ) : activeSession ? (
          <>
            <span
              className={
                activeStatus === 'connected'
                  ? 'text-mint'
                  : activeStatus === 'error'
                    ? 'text-coral'
                    : 'text-muted'
              }
            >
              ● {activeSession.name}
            </span>
            <span className="aspro-divider" />
            <span className="font-mono">{activeSession.host}</span>
            <span className="aspro-divider" />
            <span>SSH : {activeSession.port}</span>
            <span className="aspro-divider" />
            <span>
              {activeSession.authMethod === 'privateKey'
                ? 'Private key'
                : activeSession.authMethod === 'agent'
                  ? 'SSH Agent'
                  : 'Password'}
            </span>

            {activeStatus === 'connected' && (
              <>
                <span className="aspro-footer-metrics-spacer" />
                <FooterMetric
                  icon="CPU"
                  value={
                    monitorSnapshot ? `${monitorSnapshot.cpu.usagePercent.toFixed(0)}%` : '…'
                  }
                  percent={monitorSnapshot?.cpu.usagePercent ?? null}
                />
                <FooterMetric
                  icon="RAM"
                  value={memPercent === null ? '…' : `${memPercent.toFixed(0)}%`}
                  detail={
                    monitorSnapshot
                      ? `${formatBytes(monitorSnapshot.mem.usedBytes)} / ${formatBytes(
                          monitorSnapshot.mem.totalBytes,
                        )}`
                      : undefined
                  }
                  percent={memPercent}
                />
                <FooterMetric
                  icon="DISK"
                  value={diskPercent === null ? '…' : `${diskPercent.toFixed(0)}%`}
                  detail={
                    rootDisk
                      ? `${rootDisk.mount} · ${formatBytes(rootDisk.usedBytes)} / ${formatBytes(
                          rootDisk.totalBytes,
                        )}`
                      : undefined
                  }
                  percent={diskPercent}
                />
              </>
            )}
          </>
        ) : (
          <span className="text-faint">{t('status.noActiveServer')}</span>
        )}
        <span className="ml-auto text-[10px] text-faint">ASProSSH Desktop</span>
      </footer>

      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}

      {form.open && (
        <SessionForm
          existing={form.editing}
          candidates={sessions.filter((s) => s.id !== form.editing?.id)}
          onSave={async (config, secret, existingId) => {
            await save(config, secret, existingId);
            setForm({ open: false });
          }}
          onCancel={() => setForm({ open: false })}
        />
      )}

      {importing && (
        <ImportSshConfig
          onDone={async ({ imported, linked }) => {
            setImporting(false);
            await refresh();
            setImportResult(
              linked > 0
                ? `${imported} server diimpor, ${linked} tersambung lewat bastion.`
                : `${imported} server diimpor.`,
            );
            setTimeout(() => setImportResult(null), 5000);
          }}
          onCancel={() => setImporting(false)}
        />
      )}

      {importResult && (
        <div role="status" className="aspro-toast">
          {importResult}
        </div>
      )}

      {prompt && <HostKeyDialog prompt={prompt} onRespond={(id, trust) => void respond(id, trust)} />}

      {pendingDelete && (
        <ConfirmDelete
          session={pendingDelete}
          onConfirm={async () => {
            await remove(pendingDelete.id);
            if (activeId === pendingDelete.id) setActiveId(null);
            setPendingDelete(null);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

function RailButton({
  icon,
  label,
  active = false,
  muted = false,
  onClick,
}: {
  icon: string;
  label: string;
  active?: boolean;
  muted?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      className={`aspro-rail-button ${active ? 'active' : ''} ${muted ? 'muted' : ''}`}
      onClick={onClick}
      disabled={!onClick && muted}
    >
      <span className="text-xl">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function FooterMetric({
  icon,
  value,
  detail,
  percent,
}: {
  icon: string;
  value: string;
  detail?: string;
  percent: number | null;
}) {
  const clamped = percent === null ? 0 : Math.max(0, Math.min(100, percent));
  const level = clamped >= 90 ? 'danger' : clamped >= 75 ? 'warning' : 'normal';

  return (
    <div className={`aspro-footer-metric ${level}`} title={detail}>
      <span className="aspro-footer-metric-label">{icon}</span>
      <span className="aspro-footer-metric-value">{value}</span>
      <span className="aspro-footer-mini-bar">
        <i style={{ width: `${clamped}%` }} />
      </span>
    </div>
  );
}

function WorkspacePlaceholder({
  icon,
  title,
  detail,
  action,
}: {
  icon: string;
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="aspro-workspace-placeholder">
      <div className="aspro-placeholder-icon">{icon}</div>
      <strong>{title}</strong>
      <span>{detail}</span>
      {action}
    </div>
  );
}

function ConfirmDelete({
  session,
  onConfirm,
  onCancel,
}: {
  session: SessionConfig;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-6 backdrop-blur-sm">
      <div className="aspro-dialog w-full max-w-sm p-6">
        <div className="mb-1 text-[10px] uppercase tracking-[0.2em] text-orange">Konfirmasi</div>
        <h2 className="text-base font-semibold">Hapus {session.name}?</h2>
        <p className="mt-2 text-sm text-muted">
          Konfigurasi dan kredensial tersimpan akan dihapus. Server remote tidak terpengaruh.
        </p>
        <div className="mt-5 flex justify-end gap-3">
          <button onClick={onCancel} className="aspro-button aspro-button-secondary">
            Batal
          </button>
          <button onClick={onConfirm} className="aspro-button aspro-button-danger">
            Hapus
          </button>
        </div>
      </div>
    </div>
  );
}
