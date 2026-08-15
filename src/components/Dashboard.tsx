import { useEffect, useMemo, useState } from 'react';
import type { ConnectionStatus, MonitorSnapshot, SessionConfig } from '../shared/types';
import { acquireMonitor, releaseMonitor } from '../lib/monitorSubscriptions';
import { formatUptime, thresholdColor } from '../lib/format';
import { useI18n } from '../i18n';

/**
 * Ringkasan semua server yang sedang terhubung sekaligus — ditampilkan di
 * area workspace utama saat tidak ada tab yang aktif (landing state),
 * supaya tidak perlu buka Monitor satu-satu buat lihat server mana yang
 * lagi sibuk.
 */

const POLL_INTERVAL_MS = 3000;

interface DashboardProps {
  sessions: SessionConfig[];
  statuses: Record<string, ConnectionStatus>;
  onOpen: (sessionId: string) => void;
}

export function Dashboard({ sessions, statuses, onOpen }: DashboardProps) {
  const { t } = useI18n();
  const [snapshots, setSnapshots] = useState<Record<string, MonitorSnapshot>>({});

  const connected = useMemo(
    () => sessions.filter((s) => statuses[s.id] === 'connected'),
    [sessions, statuses],
  );
  const connectedIds = useMemo(() => connected.map((s) => s.id).sort().join(','), [connected]);

  useEffect(() => {
    const ids = connectedIds ? connectedIds.split(',') : [];
    for (const id of ids) acquireMonitor(id, POLL_INTERVAL_MS);
    return () => {
      for (const id of ids) releaseMonitor(id);
    };
  // connectedIds (bukan `connected` array) sengaja dipakai sebagai dependency
  // supaya efek ini cuma jalan ulang kalau SET session yang terhubung
  // sungguh berubah, bukan tiap kali array-nya dibuat ulang.
  }, [connectedIds]);

  useEffect(
    () =>
      window.ssh.monitor.onSnapshot(({ sessionId, snapshot }) => {
        setSnapshots((prev) => ({ ...prev, [sessionId]: snapshot }));
      }),
    [],
  );

  useEffect(() => {
    // Buang snapshot lama begitu server disconnect, supaya kartu yang
    // hilang tidak meninggalkan data basi kalau nanti connect lagi.
    setSnapshots((prev) => {
      const next: Record<string, MonitorSnapshot> = {};
      for (const session of connected) {
        if (prev[session.id]) next[session.id] = prev[session.id];
      }
      return next;
    });
  }, [connected]);

  if (connected.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <span className="text-2xl text-violet">▦</span>
        <strong className="text-sm text-dim">{t('dashboard.empty')}</strong>
        <span className="max-w-xs text-xs text-faint">{t('dashboard.emptyDetail')}</span>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-fg">{t('dashboard.title')}</h2>
        <span className="text-xs text-faint">{t('dashboard.subtitle', { count: connected.length })}</span>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {connected.map((session) => (
          <DashboardCard
            key={session.id}
            session={session}
            snapshot={snapshots[session.id] ?? null}
            onOpen={() => onOpen(session.id)}
          />
        ))}
      </div>
    </div>
  );
}

function DashboardCard({
  session,
  snapshot,
  onOpen,
}: {
  session: SessionConfig;
  snapshot: MonitorSnapshot | null;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  const memPercent =
    snapshot && snapshot.mem.totalBytes > 0
      ? (snapshot.mem.usedBytes / snapshot.mem.totalBytes) * 100
      : null;
  const rootDisk = snapshot?.disks.find((d) => d.mount === '/') ?? snapshot?.disks[0] ?? null;
  const diskPercent = rootDisk && rootDisk.totalBytes > 0 ? (rootDisk.usedBytes / rootDisk.totalBytes) * 100 : null;

  return (
    <button
      onClick={onOpen}
      className="flex flex-col gap-3 rounded-lg border border-line bg-panel p-3.5 text-left transition-colors hover:border-azure focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
    >
      <div className="flex items-center gap-2.5">
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
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-mint" />
            <span className="truncate text-sm font-semibold text-dim">{session.name}</span>
          </div>
          <div className="truncate font-mono text-[11px] text-faint">
            {session.username}@{session.host}
          </div>
        </div>
      </div>

      {!snapshot ? (
        <div className="py-2 text-center text-[11px] text-faint">{t('monitor.measuring')}</div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <MiniStat label="CPU" percent={snapshot.cpu.usagePercent} />
            <MiniStat label="RAM" percent={memPercent} />
            <MiniStat label="DISK" percent={diskPercent} />
          </div>
          <div className="flex items-center justify-between text-[10px] text-faint">
            <span>{t('monitor.active')} {formatUptime(snapshot.uptimeSeconds)}</span>
            <span className="font-mono">{snapshot.cpu.cores} vCPU</span>
          </div>
        </>
      )}
    </button>
  );
}

function MiniStat({ label, percent }: { label: string; percent: number | null }) {
  const clamped = percent === null ? 0 : Math.max(0, Math.min(100, percent));
  return (
    <div className="rounded border border-line-soft bg-abyss/60 px-2 py-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[9px] uppercase tracking-wider text-faint">{label}</span>
        <span
          className="font-mono text-[11px] font-semibold"
          style={{ color: percent === null ? '#655d6d' : thresholdColor(percent) }}
        >
          {percent === null ? '…' : `${percent.toFixed(0)}%`}
        </span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-active">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${clamped}%`, backgroundColor: thresholdColor(clamped) }}
        />
      </div>
    </div>
  );
}
