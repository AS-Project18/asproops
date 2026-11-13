import { useEffect, useMemo, useState } from 'react';
import type { ConnectionStatus, MonitorSnapshot, SessionConfig } from '../shared/types';
import { acquireMonitor, releaseMonitor } from '../lib/monitorSubscriptions';
import { formatBytes, formatRate, formatUptime, thresholdColor } from '../lib/format';
import { useI18n } from '../i18n';

/**
 * Fleet Overview & Multi-Server Health Dashboard.
 *
 * Menampilkan ringkasan metrik real-time semua server (CPU, RAM, DISK, Uptime, Jaringan)
 * dan seluruh server tersimpan dalam armada (fleet), dengan filter pencarian, indikator peringatan beban,
 * serta aksi satu-klik untuk menghubungkan atau membuka Terminal, File SFTP, dan Monitor.
 */

const POLL_INTERVAL_MS = 3000;

export interface DashboardProps {
  sessions: SessionConfig[];
  statuses: Record<string, ConnectionStatus>;
  onOpen: (sessionId: string) => void;
  onConnect?: (sessionId: string) => void;
  onDisconnect?: (sessionId: string) => void;
  onSelectMode?: (sessionId: string, mode: 'files' | 'monitor' | 'servers') => void;
  onNewSession?: () => void;
  onEditSession?: (session: SessionConfig) => void;
}

type StatusFilter = 'all' | 'connected' | 'disconnected' | 'alerts';
type SortOption = 'name' | 'status' | 'cpu';

export function Dashboard({
  sessions,
  statuses,
  onOpen,
  onConnect,
  onDisconnect,
  onSelectMode,
  onNewSession,
  onEditSession,
}: DashboardProps) {
  const { t } = useI18n();
  const [snapshots, setSnapshots] = useState<Record<string, MonitorSnapshot>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedGroup, setSelectedGroup] = useState<string>('all');
  const [sortBy, setSortBy] = useState<SortOption>('name');

  const connected = useMemo(
    () => sessions.filter((s) => statuses[s.id] === 'connected'),
    [sessions, statuses],
  );
  const connectedIds = useMemo(() => connected.map((s) => s.id).sort().join(','), [connected]);

  // Monitor hanya dipasang untuk server yang terhubung (zero overhead untuk server offline)
  useEffect(() => {
    const ids = connectedIds ? connectedIds.split(',') : [];
    for (const id of ids) acquireMonitor(id, POLL_INTERVAL_MS);
    return () => {
      for (const id of ids) releaseMonitor(id);
    };
  }, [connectedIds]);

  useEffect(
    () =>
      window.ssh.monitor.onSnapshot(({ sessionId, snapshot }) => {
        setSnapshots((prev) => ({ ...prev, [sessionId]: snapshot }));
      }),
    [],
  );

  useEffect(() => {
    setSnapshots((prev) => {
      const next: Record<string, MonitorSnapshot> = {};
      for (const session of connected) {
        if (prev[session.id]) next[session.id] = prev[session.id];
      }
      return next;
    });
  }, [connected]);

  // Daftar grup unik yang ada di armada
  const availableGroups = useMemo(() => {
    const set = new Set<string>();
    for (const s of sessions) {
      if (s.group?.trim()) set.add(s.group.trim());
    }
    return Array.from(set).sort();
  }, [sessions]);

  // Hitung jumlah alert (server dengan CPU/RAM > 80% atau DISK > 85%)
  const alertServerIds = useMemo(() => {
    const ids = new Set<string>();
    for (const session of connected) {
      const snap = snapshots[session.id];
      if (!snap) continue;
      const memPct =
        snap.mem.totalBytes > 0 ? (snap.mem.usedBytes / snap.mem.totalBytes) * 100 : 0;
      const rootDisk = snap.disks.find((d) => d.mount === '/') ?? snap.disks[0];
      const diskPct =
        rootDisk && rootDisk.totalBytes > 0
          ? (rootDisk.usedBytes / rootDisk.totalBytes) * 100
          : 0;

      if (snap.cpu.usagePercent >= 80 || memPct >= 80 || diskPct >= 85) {
        ids.add(session.id);
      }
    }
    return ids;
  }, [connected, snapshots]);

  // Filter & Urutkan sesi armada
  const filteredSessions = useMemo(() => {
    let result = [...sessions];

    // Filter teks pencarian
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.host.toLowerCase().includes(q) ||
          s.username.toLowerCase().includes(q) ||
          (s.group && s.group.toLowerCase().includes(q)),
      );
    }

    // Filter grup
    if (selectedGroup !== 'all') {
      result = result.filter((s) => s.group === selectedGroup);
    }

    // Filter status
    if (statusFilter === 'connected') {
      result = result.filter((s) => statuses[s.id] === 'connected');
    } else if (statusFilter === 'disconnected') {
      result = result.filter((s) => statuses[s.id] !== 'connected');
    } else if (statusFilter === 'alerts') {
      result = result.filter((s) => alertServerIds.has(s.id));
    }

    // Pengurutan
    result.sort((a, b) => {
      if (sortBy === 'status') {
        const order: Record<ConnectionStatus, number> = {
          connected: 0,
          connecting: 1,
          reconnecting: 2,
          disconnected: 3,
          error: 4,
        };
        const stA = order[statuses[a.id] ?? 'disconnected'] ?? 9;
        const stB = order[statuses[b.id] ?? 'disconnected'] ?? 9;
        if (stA !== stB) return stA - stB;
        return a.name.localeCompare(b.name);
      }
      if (sortBy === 'cpu') {
        const cpuA = snapshots[a.id]?.cpu.usagePercent ?? -1;
        const cpuB = snapshots[b.id]?.cpu.usagePercent ?? -1;
        return cpuB - cpuA;
      }
      return a.name.localeCompare(b.name);
    });

    return result;
  }, [sessions, searchQuery, selectedGroup, statusFilter, statuses, alertServerIds, sortBy, snapshots]);

  const disconnectedCount = sessions.length - connected.length;

  const handleConnectAll = () => {
    if (!onConnect) return;
    for (const session of sessions) {
      if (statuses[session.id] !== 'connected' && statuses[session.id] !== 'connecting') {
        onConnect(session.id);
      }
    }
  };

  const handleDisconnectAll = () => {
    if (!onDisconnect) return;
    for (const session of connected) {
      onDisconnect(session.id);
    }
  };

  if (sessions.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center bg-abyss">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-panel border border-line text-3xl text-azure shadow-lg shadow-black/40">
          ▦
        </div>
        <strong className="text-base font-semibold text-fg">{t('dashboard.noSavedServers')}</strong>
        <span className="max-w-md text-xs text-faint">
          {t('dashboard.noSavedServersDetail')}
        </span>
        {onNewSession && (
          <button
            onClick={onNewSession}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-azure px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-azure/90 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
          >
            + {t('dashboard.addServer')}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-abyss p-3 sm:p-5 md:p-6 text-fg">
      {/* KPI Counters Banner */}
      <div className="mb-4 sm:mb-6 grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
        <div className="flex flex-col rounded-xl border border-line bg-panel/70 p-3.5 backdrop-blur">
          <span className="text-[11px] font-medium uppercase tracking-wider text-faint">
            {t('dashboard.totalServers')}
          </span>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="font-mono text-2xl font-bold text-fg">{sessions.length}</span>
            <span className="text-xs text-dim">Fleet</span>
          </div>
        </div>

        <div className="flex flex-col rounded-xl border border-line bg-panel/70 p-3.5 backdrop-blur">
          <span className="text-[11px] font-medium uppercase tracking-wider text-faint">
            {t('dashboard.connectedCount')}
          </span>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="font-mono text-2xl font-bold text-mint">{connected.length}</span>
            <span className="flex items-center gap-1 text-xs text-mint">
              <span className="h-2 w-2 rounded-full bg-mint animate-pulse" />
              Online
            </span>
          </div>
        </div>

        <div className="flex flex-col rounded-xl border border-line bg-panel/70 p-3.5 backdrop-blur">
          <span className="text-[11px] font-medium uppercase tracking-wider text-faint">
            {t('dashboard.disconnectedCount')}
          </span>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="font-mono text-2xl font-bold text-faint">{disconnectedCount}</span>
            <span className="text-xs text-faint">Standby</span>
          </div>
        </div>

        <div
          className={`flex flex-col rounded-xl border p-3.5 backdrop-blur transition-colors ${
            alertServerIds.size > 0
              ? 'border-coral/40 bg-coral/10'
              : 'border-line bg-panel/70'
          }`}
        >
          <span className="text-[11px] font-medium uppercase tracking-wider text-faint">
            {t('dashboard.highLoadCount')}
          </span>
          <div className="mt-1 flex items-baseline justify-between">
            <span
              className={`font-mono text-2xl font-bold ${
                alertServerIds.size > 0 ? 'text-coral' : 'text-faint'
              }`}
            >
              {alertServerIds.size}
            </span>
            <span
              className={`text-xs ${alertServerIds.size > 0 ? 'text-coral' : 'text-mint'}`}
            >
              {alertServerIds.size > 0 ? 'Perlu Perhatian' : 'Optimal'}
            </span>
          </div>
        </div>
      </div>

      {/* Operations Toolbar */}
      <div className="mb-4 flex flex-col gap-2.5 sm:gap-3 rounded-xl border border-line bg-panel/50 p-2.5 sm:p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Search Bar */}
          <div className="relative min-w-[140px] flex-1 max-w-md">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-faint">
              🔍
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('dashboard.searchPlaceholder')}
              className="w-full rounded-lg border border-line bg-abyss/80 pl-8 pr-7 py-1.5 text-xs text-fg placeholder:text-faint/70 focus:border-azure focus:outline-none focus:ring-1 focus:ring-azure transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-faint hover:text-fg"
              >
                ✕
              </button>
            )}
          </div>

          {/* Quick Fleet Actions */}
          <div className="flex flex-wrap items-center gap-1.5">
            {disconnectedCount > 0 && onConnect && (
              <button
                onClick={handleConnectAll}
                className="rounded-lg border border-mint/40 bg-mint/10 px-2.5 py-1.5 text-xs font-medium text-mint hover:bg-mint/20 transition-colors"
                title="Hubungkan semua server offline sekaligus"
              >
                ▶ {t('dashboard.connectAll')}
              </button>
            )}
            {connected.length > 0 && onDisconnect && (
              <button
                onClick={handleDisconnectAll}
                className="rounded-lg border border-line bg-panel px-2.5 py-1.5 text-xs font-medium text-dim hover:bg-line hover:text-coral transition-colors"
                title="Putuskan semua server yang terhubung"
              >
                ✕ {t('dashboard.disconnectAll')}
              </button>
            )}
            {onNewSession && (
              <button
                onClick={onNewSession}
                className="rounded-lg bg-azure px-3 py-1.5 text-xs font-medium text-white hover:bg-azure/90 transition-colors"
              >
                + {t('dashboard.addServer')}
              </button>
            )}
          </div>
        </div>

        {/* Filter Pills & Selects */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-line/40 text-xs">
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 max-w-full">
            <button
              onClick={() => setStatusFilter('all')}
              className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                statusFilter === 'all'
                  ? 'bg-azure text-white font-medium shadow-sm'
                  : 'text-faint hover:bg-line hover:text-dim'
              }`}
            >
              {t('dashboard.filterAll')} ({sessions.length})
            </button>
            <button
              onClick={() => setStatusFilter('connected')}
              className={`rounded-md px-2.5 py-1 text-xs transition-colors flex items-center gap-1 ${
                statusFilter === 'connected'
                  ? 'bg-azure text-white font-medium shadow-sm'
                  : 'text-faint hover:bg-line hover:text-dim'
              }`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-mint" />
              {t('dashboard.filterConnected')} ({connected.length})
            </button>
            <button
              onClick={() => setStatusFilter('disconnected')}
              className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                statusFilter === 'disconnected'
                  ? 'bg-azure text-white font-medium shadow-sm'
                  : 'text-faint hover:bg-line hover:text-dim'
              }`}
            >
              {t('dashboard.filterDisconnected')} ({disconnectedCount})
            </button>
            {alertServerIds.size > 0 && (
              <button
                onClick={() => setStatusFilter('alerts')}
                className={`rounded-md px-2.5 py-1 text-xs transition-colors flex items-center gap-1 ${
                  statusFilter === 'alerts'
                    ? 'bg-coral text-white font-medium shadow-sm'
                    : 'text-coral hover:bg-coral/10'
                }`}
              >
                <span>⚠️</span>
                {t('dashboard.filterAlerts')} ({alertServerIds.size})
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Group Filter */}
            {availableGroups.length > 0 && (
              <select
                value={selectedGroup}
                onChange={(e) => setSelectedGroup(e.target.value)}
                className="rounded-md border border-line bg-abyss px-2 py-1 text-xs text-dim focus:border-azure focus:outline-none"
              >
                <option value="all">{t('dashboard.groupAll')}</option>
                {availableGroups.map((grp) => (
                  <option key={grp} value={grp}>
                    {grp}
                  </option>
                ))}
              </select>
            )}

            {/* Sort Dropdown */}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="rounded-md border border-line bg-abyss px-2 py-1 text-xs text-dim focus:border-azure focus:outline-none"
            >
              <option value="name">{t('dashboard.sortName')}</option>
              <option value="status">{t('dashboard.sortStatus')}</option>
              <option value="cpu">{t('dashboard.sortCpu')}</option>
            </select>
          </div>
        </div>
      </div>

      {/* Grid Kartu Server */}
      {filteredSessions.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-faint">
          <span className="text-2xl">🔍</span>
          <p className="text-xs">{t('dashboard.noServersMatch')}</p>
          <button
            onClick={() => {
              setSearchQuery('');
              setStatusFilter('all');
              setSelectedGroup('all');
            }}
            className="mt-1 rounded px-3 py-1 text-xs text-azure hover:underline"
          >
            {t('dashboard.resetFilter')}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:gap-3.5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {filteredSessions.map((session) => (
            <FleetServerCard
              key={session.id}
              session={session}
              status={statuses[session.id] ?? 'disconnected'}
              snapshot={snapshots[session.id] ?? null}
              isAlert={alertServerIds.has(session.id)}
              onOpen={() => onOpen(session.id)}
              onConnect={() => onConnect?.(session.id)}
              onDisconnect={() => onDisconnect?.(session.id)}
              onSelectMode={(mode) => onSelectMode?.(session.id, mode)}
              onEdit={() => onEditSession?.(session)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FleetServerCard({
  session,
  status,
  snapshot,
  isAlert,
  onOpen,
  onConnect,
  onDisconnect,
  onSelectMode,
  onEdit,
}: {
  session: SessionConfig;
  status: ConnectionStatus;
  snapshot: MonitorSnapshot | null;
  isAlert: boolean;
  onOpen: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onSelectMode: (mode: 'files' | 'monitor' | 'servers') => void;
  onEdit: () => void;
}) {
  const { t } = useI18n();
  const isConnected = status === 'connected';

  const memPercent =
    snapshot && snapshot.mem.totalBytes > 0
      ? (snapshot.mem.usedBytes / snapshot.mem.totalBytes) * 100
      : null;
  const rootDisk = snapshot?.disks.find((d) => d.mount === '/') ?? snapshot?.disks[0] ?? null;
  const diskPercent =
    rootDisk && rootDisk.totalBytes > 0
      ? (rootDisk.usedBytes / rootDisk.totalBytes) * 100
      : null;

  return (
    <div
      className={`group flex flex-col justify-between rounded-xl border bg-panel transition-all duration-200 shadow-sm hover:shadow-md ${
        isAlert
          ? 'border-coral/60 bg-coral/[0.03]'
          : isConnected
          ? 'border-line hover:border-azure/70'
          : 'border-line/70 opacity-90 hover:opacity-100 hover:border-line'
      }`}
    >
      <div className="p-4">
        {/* Header: Avatar, Nama, Status */}
        <div className="flex items-start gap-3">
          <span
            className="aspro-server-avatar shrink-0 text-xs font-bold"
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

          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-1">
              <h3
                onClick={isConnected ? onOpen : onConnect}
                className="truncate text-sm font-semibold text-fg hover:text-azure cursor-pointer transition-colors"
                title={session.name}
              >
                {session.name}
              </h3>

              <div className="flex items-center gap-1.5 shrink-0">
                {isAlert && (
                  <span className="rounded bg-coral/20 px-1.5 py-0.5 text-[10px] font-semibold text-coral animate-pulse">
                    ⚠️ High Load
                  </span>
                )}
                <StatusBadge status={status} />
              </div>
            </div>

            <div className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-faint">
              <span className="font-mono truncate">
                {session.username}@{session.host}:{session.port}
              </span>
              {session.group && (
                <span className="rounded bg-abyss px-1.5 py-0.2 text-[10px] text-dim border border-line/60">
                  {session.group}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Metrik Real-time atau Info Standby */}
        <div className="mt-3.5">
          {isConnected ? (
            !snapshot ? (
              <div className="py-4 text-center text-xs text-faint animate-pulse">
                {t('monitor.measuring')}…
              </div>
            ) : (
              <div className="space-y-2.5">
                <div className="grid grid-cols-3 gap-2">
                  <StatGauge
                    label="CPU"
                    percent={snapshot.cpu.usagePercent}
                    detail={`${snapshot.cpu.cores} core`}
                  />
                  <StatGauge
                    label="RAM"
                    percent={memPercent}
                    detail={
                      snapshot.mem.totalBytes > 0
                        ? `${formatBytes(snapshot.mem.usedBytes, 0)} / ${formatBytes(
                            snapshot.mem.totalBytes,
                            0,
                          )}`
                        : undefined
                    }
                  />
                  <StatGauge
                    label="DISK"
                    percent={diskPercent}
                    detail={
                      rootDisk
                        ? `${formatBytes(rootDisk.usedBytes, 0)} / ${formatBytes(
                            rootDisk.totalBytes,
                            0,
                          )}`
                        : undefined
                    }
                  />
                </div>

                <div className="flex items-center justify-between text-[10px] text-faint pt-1">
                  <span>
                    {t('monitor.active')} {formatUptime(snapshot.uptimeSeconds)}
                  </span>
                  {snapshot.net && snapshot.net.length > 0 && (
                    <span className="font-mono">
                      ↓ {formatRate(snapshot.net.reduce((acc, n) => acc + n.rxBytesPerSec, 0))} &nbsp; ↑{' '}
                      {formatRate(snapshot.net.reduce((acc, n) => acc + n.txBytesPerSec, 0))}
                    </span>
                  )}
                </div>
              </div>
            )
          ) : (
            <div className="rounded-lg border border-line-soft/60 bg-abyss/40 p-3 text-xs text-faint">
              <div className="flex items-center justify-between text-[11px]">
                <span>Otentikasi:</span>
                <span className="font-mono text-dim">
                  {session.authMethod === 'privateKey'
                    ? 'SSH Key'
                    : session.authMethod === 'agent'
                    ? 'SSH Agent'
                    : 'Password'}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between text-[11px]">
                <span>Port:</span>
                <span className="font-mono text-dim">{session.port}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Action Footer */}
      <div className="flex items-center justify-between border-t border-line/60 bg-abyss/40 px-3 py-2 text-xs">
        {isConnected ? (
          <>
            <div className="flex items-center gap-1">
              <button
                onClick={onOpen}
                className="flex items-center gap-1 rounded px-2 py-1 text-dim hover:bg-line hover:text-fg transition-colors"
                title="Buka Terminal Server"
              >
                <span>📟</span> {t('dashboard.openTerminal')}
              </button>
              <button
                onClick={() => onSelectMode('files')}
                className="flex items-center gap-1 rounded px-2 py-1 text-dim hover:bg-line hover:text-fg transition-colors"
                title="Buka File Browser SFTP"
              >
                <span>📁</span> {t('dashboard.openFiles')}
              </button>
              <button
                onClick={() => onSelectMode('monitor')}
                className="flex items-center gap-1 rounded px-2 py-1 text-dim hover:bg-line hover:text-fg transition-colors"
                title="Buka Detail Monitor Sistem"
              >
                <span>📊</span> {t('dashboard.openMonitor')}
              </button>
            </div>
            <button
              onClick={onDisconnect}
              className="rounded px-2 py-1 text-faint hover:bg-coral/10 hover:text-coral transition-colors"
              title="Putus koneksi server"
            >
              ✕ {t('dashboard.disconnectNow')}
            </button>
          </>
        ) : (
          <>
            <button
              onClick={onEdit}
              className="rounded px-2 py-1 text-faint hover:bg-line hover:text-fg transition-colors"
              title="Edit konfigurasi server"
            >
              ⚙️ {t('dashboard.editConfig')}
            </button>
            <button
              onClick={onConnect}
              className="flex items-center gap-1 rounded-lg bg-mint/15 px-3 py-1 font-semibold text-mint hover:bg-mint/25 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-mint"
              title="Hubungkan server sekarang"
            >
              ▶ {t('dashboard.connectNow')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function StatGauge({
  label,
  percent,
  detail,
}: {
  label: string;
  percent: number | null;
  detail?: string;
}) {
  const clamped = percent === null ? 0 : Math.max(0, Math.min(100, percent));
  const color = percent === null ? '#655d6d' : thresholdColor(clamped);

  return (
    <div className="rounded-lg border border-line-soft bg-abyss/60 p-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-faint">
          {label}
        </span>
        <span className="font-mono text-xs font-bold" style={{ color }}>
          {percent === null ? '…' : `${percent.toFixed(0)}%`}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-active">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${clamped}%`, backgroundColor: color }}
        />
      </div>
      {detail && (
        <div className="mt-1 truncate font-mono text-[9px] text-faint/80">{detail}</div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: ConnectionStatus }) {
  if (status === 'connected') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-mint/15 px-2 py-0.5 text-[10px] font-semibold text-mint">
        <span className="h-1.5 w-1.5 rounded-full bg-mint" />
        Online
      </span>
    );
  }
  if (status === 'connecting' || status === 'reconnecting') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-azure/15 px-2 py-0.5 text-[10px] font-semibold text-azure">
        <span className="h-1.5 w-1.5 rounded-full bg-azure animate-ping" />
        Menyambung…
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-coral/15 px-2 py-0.5 text-[10px] font-semibold text-coral">
        ✕ Error
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-line/60 px-2 py-0.5 text-[10px] font-medium text-faint">
      Offline
    </span>
  );
}
