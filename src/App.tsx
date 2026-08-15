import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import asproIcon from './assets/asproops-icon.png';
import { SessionSidebar } from './components/SessionSidebar';
import { SessionForm } from './components/SessionForm';
import { HostKeyDialog, useHostKeyPrompts } from './components/HostKeyDialog';
import { ImportSshConfig } from './components/ImportSshConfig';
import { TerminalTabs } from './components/TerminalTabs';
import { FileBrowser } from './components/FileBrowser';
import { MonitorPanel } from './components/MonitorPanel';
import { LocalTerminalPanel } from './components/LocalTerminalPanel';
import { LocalTerminalView } from './components/LocalTerminalView';
import { LogView } from './components/LogView';
import { DeployView } from './components/DeployView';
import { ProjectsPanel } from './components/ProjectsPanel';
import { ServicesPanel } from './components/ServicesPanel';
import { GitPanel } from './components/GitPanel';
import { SettingsDialog } from './components/SettingsDialog';
import { QuickConnectPalette } from './components/QuickConnectPalette';
import { Dashboard } from './components/Dashboard';
import { useI18n } from './i18n';
import { useSessions } from './hooks/useSessions';
import { formatBytes, formatRate } from './lib/format';
import type {
  DeployWorkspace,
  LocalTerminalProfile,
  LocalTerminalWorkspace,
  LogWorkspace,
  MonitorSnapshot,
  ProjectProfile,
  SessionConfig,
} from './shared/types';

function basename(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path;
}

type FormState = { open: false } | { open: true; editing: SessionConfig | null };
type LeftMode = 'servers' | 'local' | 'files' | 'monitor' | 'projects' | 'services' | 'git';

export default function App() {
  const { t } = useI18n();
  const { sessions, statuses, errors, loading, connect, disconnect, save, remove, refresh } =
    useSessions();
  const { prompt, respond } = useHostKeyPrompts();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeLocalId, setActiveLocalId] = useState<string | null>(null);
  const [activeLogId, setActiveLogId] = useState<string | null>(null);
  const [activeDeployId, setActiveDeployId] = useState<string | null>(null);
  /**
   * Dashboard itu tab ke-5 yang selalu ada dan tidak bisa ditutup — beda
   * dari 4 kind lain yang array-based (bisa nol atau banyak), ini cukup
   * boolean karena cuma satu instance dan tidak pernah "tidak ada sama
   * sekali". Defaultnya aktif supaya begitu app dibuka ada tab yang
   * kelihatan, bukan layar kosong.
   */
  const [dashboardActive, setDashboardActive] = useState(true);
  const [localProfiles, setLocalProfiles] = useState<LocalTerminalProfile[]>([]);
  const [localProfilesLoading, setLocalProfilesLoading] = useState(true);
  const [localWorkspaces, setLocalWorkspaces] = useState<LocalTerminalWorkspace[]>([]);
  const [logWorkspaces, setLogWorkspaces] = useState<LogWorkspace[]>([]);
  const [deployWorkspaces, setDeployWorkspaces] = useState<DeployWorkspace[]>([]);
  const [serviceFocus, setServiceFocus] = useState<string | null>(null);
  const [gitFocusProjectId, setGitFocusProjectId] = useState<string | null>(null);
  const [leftMode, setLeftMode] = useState<LeftMode>('servers');
  const [leftWidth, setLeftWidth] = useState(330);
  const [resizingLeft, setResizingLeft] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [monitorSnapshot, setMonitorSnapshot] = useState<MonitorSnapshot | null>(null);
  const [form, setForm] = useState<FormState>({ open: false });
  const [pendingDelete, setPendingDelete] = useState<SessionConfig | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  /**
   * Sesi SSH yang punya tab terbuka — simetris dengan `localWorkspaces`.
   * Diisi begitu user menekan connect, bukan menunggu status 'connected',
   * supaya tab (dan tombol tutupnya) langsung ada meski koneksi masih
   * berjalan atau gagal. Tab tidak hilang otomatis saat disconnect; hanya
   * tombol tutup yang melepasnya, sama seperti terminal lokal.
   */
  const [openSessions, setOpenSessions] = useState<string[]>([]);
  /**
   * Subset dari openSessions yang TerminalTabs-nya sungguh dipasang. Begitu
   * sebuah sesi tersambung sekali, tetap dipasang selama statusnya bukan
   * 'disconnected' (termasuk saat reconnecting/error) supaya scrollback
   * tidak hilang gara-gara koneksi sempat putus — beda dari openSessions
   * yang menentukan tab-nya masih tampil atau tidak.
   */
  const [mountedSessions, setMountedSessions] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [quickConnectOpen, setQuickConnectOpen] = useState(false);

  useEffect(() => {
    setMountedSessions((prev) => {
      const ready = Object.entries(statuses)
        .filter(([id, status]) => status === 'connected' && openSessions.includes(id))
        .map(([id]) => id);

      const kept = prev.filter(
        (id) => openSessions.includes(id) && statuses[id] && statuses[id] !== 'disconnected',
      );
      const next = [...new Set([...kept, ...ready])];

      return next.length === prev.length && next.every((id, i) => id === prev[i]) ? prev : next;
    });
  }, [statuses, openSessions]);


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
  const activeLog = logWorkspaces.find((workspace) => workspace.id === activeLogId) ?? null;
  const activeDeploy = deployWorkspaces.find((workspace) => workspace.id === activeDeployId) ?? null;
  // dashboardActive OR fallback kalau ternyata tidak ada satu pun tab lain
  // yang aktif (mis. gara-gara ada state transition yang lupa menyalakan
  // dashboardActive secara eksplisit) — jangan sampai layar workspace
  // kosong sama sekali tanpa tab manapun yang kelihatan aktif.
  const showDashboard = dashboardActive || (!activeSession && !activeLocal && !activeLog && !activeDeploy);
  const connectedCount = useMemo(
    () => Object.values(statuses).filter((status) => status === 'connected').length,
    [statuses],
  );

  // Ctrl+K = Quick Connect, dari mana saja. Ctrl+Shift+T (terminal baru)
  // sudah ditangani lokal oleh TerminalView saat xterm sedang fokus — ini
  // cuma fallback untuk saat fokus ada di tempat lain (mis. abis klik
  // panel Files) tapi tab SSH masih yang aktif. Guard .xterm mencegah
  // dobel-trigger kalau kedua handler sama-sama kena keystroke yang sama.
  useEffect(() => {
    const handleGlobalKeydown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();

      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && key === 'k') {
        if (form.open || settingsOpen || importing || pendingDelete) return;
        event.preventDefault();
        setQuickConnectOpen(true);
        return;
      }

      if (event.ctrlKey && event.shiftKey && key === 't') {
        if ((event.target as HTMLElement | null)?.closest('.xterm')) return;
        if (!activeSession) return;
        event.preventDefault();
        window.dispatchEvent(
          new CustomEvent('asproops:new-terminal', { detail: { sessionId: activeSession.id } }),
        );
      }
    };

    window.addEventListener('keydown', handleGlobalKeydown);
    return () => window.removeEventListener('keydown', handleGlobalKeydown);
  }, [activeSession, form.open, settingsOpen, importing, pendingDelete]);

  /** Klik tombol nav mana pun juga membuka lagi sidebar kalau lagi disembunyikan — tujuannya kan mau lihat panelnya. */
  const selectLeftMode = (mode: LeftMode) => {
    setLeftMode(mode);
    setLeftCollapsed(false);
  };

  /** Tab Dashboard tetap "diingat" (activeId dkk tidak disentuh) — buka lagi lewat rail sama seperti sebelumnya. */
  const activateDashboard = () => {
    setActiveLocalId(null);
    setActiveId(null);
    setActiveLogId(null);
    setActiveDeployId(null);
    setDashboardActive(true);
  };

  const handleSelectRemote = (id: string) => {
    setActiveLocalId(null);
    setActiveLogId(null);
    setActiveDeployId(null);
    setDashboardActive(false);
    setActiveId(id);
  };

  const activateRemoteWorkspace = (id: string) => {
    setActiveLocalId(null);
    setActiveLogId(null);
    setActiveDeployId(null);
    setDashboardActive(false);
    setActiveId(id);
  };

  const activateLocalWorkspace = (workspaceId: string) => {
    setActiveLogId(null);
    setActiveDeployId(null);
    setDashboardActive(false);
    setActiveLocalId(workspaceId);
  };

  const activateLogWorkspace = (workspaceId: string) => {
    setActiveLocalId(null);
    setActiveId(null);
    setActiveDeployId(null);
    setDashboardActive(false);
    setActiveLogId(workspaceId);
  };

  const activateDeployWorkspace = (workspaceId: string) => {
    setActiveLocalId(null);
    setActiveId(null);
    setActiveLogId(null);
    setDashboardActive(false);
    setActiveDeployId(workspaceId);
  };

  const handleConnect = (id: string) => {
    setOpenSessions((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setActiveLocalId(null);
    setActiveLogId(null);
    setActiveDeployId(null);
    setDashboardActive(false);
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
    setActiveLogId(null);
    setActiveDeployId(null);
    setDashboardActive(false);
    setActiveLocalId(workspace.id);
    setLeftMode('local');
  };

  /**
   * Dipanggil dari ProjectsPanel. Kalau log path yang sama di session yang
   * sama sudah punya tab, cukup fokuskan — supaya klik berulang tidak
   * numpuk tab identik.
   */
  const openLogView = (sessionId: string, path: string) => {
    const existing = logWorkspaces.find((w) => w.sessionId === sessionId && w.path === path);
    if (existing) {
      activateLogWorkspace(existing.id);
      return;
    }

    const workspace: LogWorkspace = { id: crypto.randomUUID(), sessionId, path, createdAt: Date.now() };
    setLogWorkspaces((current) => [...current, workspace]);
    setActiveLocalId(null);
    setActiveId(null);
    setActiveDeployId(null);
    setDashboardActive(false);
    setActiveLogId(workspace.id);
  };

  /**
   * Dipanggil dari ProjectsPanel saat sebuah chip layanan diklik — beda dari
   * openLogView, ini tidak membuka tab baru, cuma memindahkan panel kiri ke
   * Service Manager dan menyorot nama unit-nya di kotak pencarian. Selalu
   * untuk session yang sedang aktif, jadi tidak perlu parameter sessionId.
   */
  const openServiceManager = (unit: string) => {
    setServiceFocus(unit);
    setLeftMode('services');
  };

  const openGitPanel = (projectId: string) => {
    setGitFocusProjectId(projectId);
    setLeftMode('git');
  };

  /**
   * Dipanggil dari ProjectsPanel setelah pengguna konfirmasi menjalankan
   * deploy. Beda dari openLogView: selalu bikin tab baru (tidak dedup) —
   * tiap run deploy itu proses sekali-jalan yang independen, jejak run
   * sebelumnya tetap berguna dilihat, bukan sesuatu yang harus difokuskan
   * ulang seperti stream log yang sama.
   */
  const openDeployView = (project: ProjectProfile, templateName: string) => {
    const workspace: DeployWorkspace = {
      id: crypto.randomUUID(),
      sessionId: project.sessionId,
      projectId: project.id,
      projectName: project.name,
      templateName,
      createdAt: Date.now(),
    };
    setDeployWorkspaces((current) => [...current, workspace]);
    setActiveLocalId(null);
    setActiveId(null);
    setActiveLogId(null);
    setDashboardActive(false);
    setActiveDeployId(workspace.id);
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
        const lastRemote = openSessions.at(-1);
        if (lastRemote) setActiveId(lastRemote);
        else {
          const lastLog = logWorkspaces.at(-1);
          if (lastLog) setActiveLogId(lastLog.id);
          else {
            const lastDeploy = deployWorkspaces.at(-1);
            if (lastDeploy) setActiveDeployId(lastDeploy.id);
            else setDashboardActive(true);
          }
        }
      }
    }
  };

  const closeRemoteSession = (sessionId: string) => {
    const status = statuses[sessionId];
    if (status === 'connected' || status === 'connecting' || status === 'reconnecting') {
      void disconnect(sessionId);
    }

    const remaining = openSessions.filter((id) => id !== sessionId);
    setOpenSessions(remaining);

    if (activeId === sessionId) {
      const nextRemote = remaining.at(-1);
      if (nextRemote) {
        setActiveId(nextRemote);
      } else {
        setActiveId(null);
        const lastLocal = localWorkspaces.at(-1);
        if (lastLocal) setActiveLocalId(lastLocal.id);
        else {
          const lastLog = logWorkspaces.at(-1);
          if (lastLog) setActiveLogId(lastLog.id);
          else {
            const lastDeploy = deployWorkspaces.at(-1);
            if (lastDeploy) setActiveDeployId(lastDeploy.id);
            else setDashboardActive(true);
          }
        }
      }
    }
  };

  const closeLogView = (workspaceId: string) => {
    const remaining = logWorkspaces.filter((item) => item.id !== workspaceId);
    setLogWorkspaces(remaining);

    if (activeLogId === workspaceId) {
      const nextLog = remaining.at(-1);
      if (nextLog) {
        setActiveLogId(nextLog.id);
      } else {
        setActiveLogId(null);
        const lastLocal = localWorkspaces.at(-1);
        if (lastLocal) setActiveLocalId(lastLocal.id);
        else {
          const lastRemote = openSessions.at(-1);
          if (lastRemote) setActiveId(lastRemote);
          else {
            const lastDeploy = deployWorkspaces.at(-1);
            if (lastDeploy) setActiveDeployId(lastDeploy.id);
            else setDashboardActive(true);
          }
        }
      }
    }
  };

  const closeDeployView = (workspaceId: string) => {
    const remaining = deployWorkspaces.filter((item) => item.id !== workspaceId);
    setDeployWorkspaces(remaining);

    if (activeDeployId === workspaceId) {
      const nextDeploy = remaining.at(-1);
      if (nextDeploy) {
        setActiveDeployId(nextDeploy.id);
      } else {
        setActiveDeployId(null);
        const lastLocal = localWorkspaces.at(-1);
        if (lastLocal) setActiveLocalId(lastLocal.id);
        else {
          const lastRemote = openSessions.at(-1);
          if (lastRemote) setActiveId(lastRemote);
          else {
            const lastLog = logWorkspaces.at(-1);
            if (lastLog) setActiveLogId(lastLog.id);
            else setDashboardActive(true);
          }
        }
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
              <strong>ASPro</strong><span>Ops</span>
            </div>
            <div className="aspro-brand-subtitle">{t('app.tagline')}</div>
          </div>
        </div>

        <button className="aspro-quick" onClick={() => setQuickConnectOpen(true)}>
          <span className="aspro-bolt">ϟ</span>
          <span className="truncate">{t('app.quickConnect')}</span>
          <span className="ml-auto text-[12px] text-faint">Ctrl + K</span>
        </button>

        <div className="aspro-top-actions">
          <div className="hidden text-right xl:block">
            <div className="text-[12px] uppercase tracking-[0.18em] text-faint">{t('app.activeServers')}</div>
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
          gridTemplateColumns: leftCollapsed
            ? '78px minmax(420px, 1fr)'
            : `78px ${leftWidth}px minmax(420px, 1fr)`,
        }}
      >
        <aside className="aspro-rail" aria-label={t('nav.connections')}>
          <RailButton
            active={leftMode === 'servers'}
            icon="$_"
            label={t('nav.connections')}
            onClick={() => selectLeftMode('servers')}
          />
          <RailButton
            active={leftMode === 'local'}
            icon=">_"
            label={t('nav.local')}
            onClick={() => selectLeftMode('local')}
          />
          <RailButton
            active={leftMode === 'files'}
            icon="□"
            label={t('nav.sftp')}
            onClick={() => selectLeftMode('files')}
          />
          <RailButton
            active={leftMode === 'monitor'}
            icon="⌁"
            label={t('nav.monitor')}
            onClick={() => selectLeftMode('monitor')}
          />
          <RailButton
            active={leftMode === 'projects'}
            icon="▣"
            label={t('nav.projects')}
            onClick={() => selectLeftMode('projects')}
          />
          <RailButton
            active={leftMode === 'git'}
            icon="⎇"
            label={t('nav.git')}
            onClick={() => selectLeftMode('git')}
          />
          <RailButton
            active={leftMode === 'services'}
            icon="⏻"
            label={t('nav.services')}
            onClick={() => selectLeftMode('services')}
          />
          <div className="flex-1" />
          <RailButton
            icon={leftCollapsed ? '⇥' : '⇤'}
            label={leftCollapsed ? t('nav.showSidebar') : t('nav.hideSidebar')}
            onClick={() => setLeftCollapsed((v) => !v)}
          />
          <RailButton icon="⚙" label={t('nav.settings')} onClick={() => setSettingsOpen(true)} />
        </aside>

        {!leftCollapsed && (
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

                <div
                  className={
                    leftMode === 'projects'
                      ? 'absolute inset-0'
                      : 'pointer-events-none invisible absolute inset-0'
                  }
                >
                  <ProjectsPanel
                    sessionId={activeSession.id}
                    onOpenLog={openLogView}
                    onOpenService={openServiceManager}
                    onOpenGit={openGitPanel}
                    onOpenDeploy={openDeployView}
                  />
                </div>

                <div
                  className={
                    leftMode === 'services'
                      ? 'absolute inset-0'
                      : 'pointer-events-none invisible absolute inset-0'
                  }
                >
                  <ServicesPanel sessionId={activeSession.id} focusService={serviceFocus} />
                </div>

                <div
                  className={
                    leftMode === 'git'
                      ? 'absolute inset-0'
                      : 'pointer-events-none invisible absolute inset-0'
                  }
                >
                  <GitPanel sessionId={activeSession.id} focusProjectId={gitFocusProjectId} />
                </div>
              </>
            ) : (
              (leftMode === 'files' ||
                leftMode === 'monitor' ||
                leftMode === 'projects' ||
                leftMode === 'services' ||
                leftMode === 'git') && (
                <div className="aspro-side-placeholder absolute inset-0">
                  <div className="aspro-side-placeholder-icon">
                    {leftMode === 'files'
                      ? '□'
                      : leftMode === 'monitor'
                        ? '⌁'
                        : leftMode === 'services'
                          ? '⏻'
                          : leftMode === 'git'
                            ? '⎇'
                            : '▣'}
                  </div>
                  <strong>
                    {leftMode === 'files'
                      ? t('placeholder.sftp')
                      : leftMode === 'monitor'
                        ? t('placeholder.monitor')
                        : leftMode === 'services'
                          ? t('placeholder.services')
                          : leftMode === 'git'
                            ? t('placeholder.git')
                            : t('placeholder.projects')}
                  </strong>
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
        )}

        <main className="aspro-center">
          <div className="aspro-workspace-tabs">
            <button
              className={`aspro-workspace-tab ${dashboardActive ? 'active' : ''}`}
              onClick={activateDashboard}
              title={t('dashboard.title')}
            >
              <span className="aspro-workspace-tab-dot dashboard" />
              <span className="truncate">{t('dashboard.title')}</span>
            </button>

            {openSessions.map((id) => {
              const session = sessions.find((item) => item.id === id);
              if (!session) return null;
              const isActive = !activeLocalId && activeId === id;
              const status = statuses[id] ?? 'disconnected';

              return (
                <button
                  key={`ssh:${id}`}
                  className={`aspro-workspace-tab ${isActive ? 'active' : ''}`}
                  onClick={() => activateRemoteWorkspace(id)}
                  title={`${session.username}@${session.host}:${session.port}`}
                >
                  <span
                    className={`aspro-workspace-tab-dot ssh ${
                      status === 'connecting' || status === 'reconnecting'
                        ? 'pending'
                        : status === 'error'
                          ? 'error'
                          : ''
                    }`}
                  />
                  <span className="truncate">{session.name}</span>
                  <span className="aspro-workspace-tab-kind">SSH</span>
                  <span
                    role="button"
                    tabIndex={0}
                    className="aspro-workspace-tab-close"
                    onClick={(event) => {
                      event.stopPropagation();
                      closeRemoteSession(id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        event.stopPropagation();
                        closeRemoteSession(id);
                      }
                    }}
                    title="Tutup sesi SSH"
                  >
                    ×
                  </span>
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

            {logWorkspaces.map((workspace) => {
              const isActive = activeLogId === workspace.id;

              return (
                <button
                  key={`log:${workspace.id}`}
                  className={`aspro-workspace-tab ${isActive ? 'active' : ''}`}
                  onClick={() => activateLogWorkspace(workspace.id)}
                  title={workspace.path}
                >
                  <span className="aspro-workspace-tab-dot log" />
                  <span className="truncate">{basename(workspace.path)}</span>
                  <span className="aspro-workspace-tab-kind">LOG</span>
                  <span
                    role="button"
                    tabIndex={0}
                    className="aspro-workspace-tab-close"
                    onClick={(event) => {
                      event.stopPropagation();
                      closeLogView(workspace.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        event.stopPropagation();
                        closeLogView(workspace.id);
                      }
                    }}
                    title="Tutup log viewer"
                  >
                    ×
                  </span>
                </button>
              );
            })}

            {deployWorkspaces.map((workspace) => {
              const isActive = activeDeployId === workspace.id;

              return (
                <button
                  key={`deploy:${workspace.id}`}
                  className={`aspro-workspace-tab ${isActive ? 'active' : ''}`}
                  onClick={() => activateDeployWorkspace(workspace.id)}
                  title={`${workspace.projectName} · ${workspace.templateName}`}
                >
                  <span className="aspro-workspace-tab-dot deploy" />
                  <span className="truncate">{workspace.projectName}</span>
                  <span className="aspro-workspace-tab-kind">DEPLOY</span>
                  <span
                    role="button"
                    tabIndex={0}
                    className="aspro-workspace-tab-close"
                    onClick={(event) => {
                      event.stopPropagation();
                      closeDeployView(workspace.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        event.stopPropagation();
                        closeDeployView(workspace.id);
                      }
                    }}
                    title="Tutup deploy"
                  >
                    ×
                  </span>
                </button>
              );
            })}

          </div>

          <div className="aspro-session-header">
            {showDashboard ? (
              <div>
                <div className="text-sm font-semibold text-fg">{t('dashboard.title')}</div>
                <div className="text-[12px] text-faint">
                  {t('dashboard.subtitle', { count: connectedCount })}
                </div>
              </div>
            ) : activeDeploy ? (
              <>
                <div className="aspro-live-dot online" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-fg">
                    {activeDeploy.projectName}
                  </div>
                  <div className="truncate font-mono text-[12px] text-faint">
                    {activeDeploy.templateName}
                  </div>
                </div>
                <span className="aspro-local-chip">DEPLOY</span>
                <span className="aspro-status-chip connected">{t('workspace.active')}</span>

                <div className="ml-auto">
                  <button
                    onClick={() => closeDeployView(activeDeploy.id)}
                    className="aspro-button aspro-button-danger"
                  >
                    {t('workspace.close')}
                  </button>
                </div>
              </>
            ) : activeLog ? (
              <>
                <div className="aspro-live-dot online" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-fg">
                    {basename(activeLog.path)}
                  </div>
                  <div className="truncate font-mono text-[12px] text-faint">{activeLog.path}</div>
                </div>
                <span className="aspro-local-chip">LOG</span>
                <span className="aspro-status-chip connected">{t('workspace.active')}</span>

                <div className="ml-auto">
                  <button
                    onClick={() => closeLogView(activeLog.id)}
                    className="aspro-button aspro-button-danger"
                  >
                    {t('workspace.close')}
                  </button>
                </div>
              </>
            ) : activeLocal ? (
              <>
                <div className="aspro-live-dot online" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-fg">
                    {activeLocal.profile.kind === 'wsl'
                      ? `WSL · ${activeLocal.profile.name}`
                      : activeLocal.profile.name}
                  </div>
                  <div className="truncate font-mono text-[12px] text-faint">
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
                  <div className="truncate font-mono text-[12px] text-faint">
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
            ) : null}
          </div>

          <div className="aspro-terminal-card">
            {mountedSessions.map((id) => {
              const isActive = !activeLocalId && statuses[id] === 'connected' && id === activeId;
              return (
                <div
                  key={id}
                  // display:none di sini bikin xterm gagal ukur dimensi
                  // saat TerminalView baru dipasang sementara tabnya tidak
                  // aktif (mis. connect selesai saat user lihat tab lain).
                  className={isActive ? 'absolute inset-0' : 'pointer-events-none invisible absolute inset-0'}
                >
                  <TerminalTabs sessionId={id} visible={isActive} />
                </div>
              );
            })}

            {localWorkspaces.map((workspace) => (
              <div
                key={workspace.id}
                className={
                  workspace.id === activeLocalId
                    ? 'absolute inset-0'
                    : 'pointer-events-none invisible absolute inset-0'
                }
              >
                <LocalTerminalView
                  workspaceId={workspace.id}
                  profile={workspace.profile}
                  active={workspace.id === activeLocalId}
                  onExit={() => closeLocalTerminal(workspace.id)}
                />
              </div>
            ))}

            {logWorkspaces.map((workspace) => (
              <div
                key={workspace.id}
                className={
                  workspace.id === activeLogId
                    ? 'absolute inset-0'
                    : 'pointer-events-none invisible absolute inset-0'
                }
              >
                <LogView
                  sessionId={workspace.sessionId}
                  path={workspace.path}
                  active={workspace.id === activeLogId}
                  onExit={() => closeLogView(workspace.id)}
                />
              </div>
            ))}

            {deployWorkspaces.map((workspace) => (
              <div
                key={workspace.id}
                className={
                  workspace.id === activeDeployId
                    ? 'absolute inset-0'
                    : 'pointer-events-none invisible absolute inset-0'
                }
              >
                <DeployView
                  sessionId={workspace.sessionId}
                  projectId={workspace.projectId}
                  active={workspace.id === activeDeployId}
                  onExit={() => closeDeployView(workspace.id)}
                />
              </div>
            ))}

            <div
              className={
                showDashboard ? 'absolute inset-0' : 'pointer-events-none invisible absolute inset-0'
              }
            >
              <Dashboard sessions={sessions} statuses={statuses} onOpen={handleSelectRemote} />
            </div>

            {showDashboard || activeLog || activeLocal || activeDeploy ? null : loading ? (
              <WorkspacePlaceholder
                icon="⌁"
                title={t('workspace.loadingServers')}
                detail={t('workspace.readingConfig')}
              />
            ) : !activeSession ? null : activeStatus === 'connecting' || activeStatus === 'reconnecting' ? (
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
        {showDashboard ? (
          <>
            <span className="text-mint">● {t('dashboard.title')}</span>
            <span className="aspro-divider" />
            <span>{t('dashboard.subtitle', { count: connectedCount })}</span>
          </>
        ) : activeDeploy ? (
          <>
            <span className="text-mint">● {activeDeploy.projectName}</span>
            <span className="aspro-divider" />
            <span>DEPLOY</span>
            <span className="aspro-divider" />
            <span className="font-mono">{activeDeploy.templateName}</span>
          </>
        ) : activeLog ? (
          <>
            <span className="text-mint">● {basename(activeLog.path)}</span>
            <span className="aspro-divider" />
            <span>LOG</span>
            <span className="aspro-divider" />
            <span className="font-mono">{activeLog.path}</span>
          </>
        ) : activeLocal ? (
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
                {monitorSnapshot && (
                  <FooterMetric
                    icon="NET"
                    value={`↓${formatRate(
                      monitorSnapshot.net.reduce((sum, n) => sum + n.rxBytesPerSec, 0),
                    )} ↑${formatRate(
                      monitorSnapshot.net.reduce((sum, n) => sum + n.txBytesPerSec, 0),
                    )}`}
                    percent={null}
                  />
                )}
              </>
            )}
          </>
        ) : null}
        <span className="ml-auto text-[12px] text-faint">ASProOps Desktop</span>
      </footer>

      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}

      {quickConnectOpen && (
        <QuickConnectPalette
          sessions={sessions}
          statuses={statuses}
          onSelect={handleConnect}
          onClose={() => setQuickConnectOpen(false)}
        />
      )}

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
            if (activeId === pendingDelete.id) {
              setActiveId(null);
              setDashboardActive(true);
            }
            setOpenSessions((prev) => prev.filter((id) => id !== pendingDelete.id));
            setLogWorkspaces((prev) => prev.filter((w) => w.sessionId !== pendingDelete.id));
            setDeployWorkspaces((prev) => prev.filter((w) => w.sessionId !== pendingDelete.id));
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
        <div className="mb-1 text-[12px] uppercase tracking-[0.2em] text-orange">Konfirmasi</div>
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
