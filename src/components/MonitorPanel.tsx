import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MonitorSnapshot, ProcessSample } from '../shared/types';
import { Chart } from './Chart';
import { formatBytes, formatRate, formatUptime, thresholdColor } from '../lib/format';
import { acquireMonitor, releaseMonitor } from '../lib/monitorSubscriptions';
import { useI18n } from '../i18n';

/**
 * Panel monitor server & Interactive Process Manager.
 *
 * Riwayat grafik disimpan di renderer. Dilengkapi pengurutan, pencarian,
 * jeda pembaruan (pause/freeze), serta kontrol penghentian proses (SIGTERM / SIGKILL)
 * dengan fallback eksekusi sudo bila membutuhkan izin elevated.
 */

const HISTORY_LENGTH = 150;
const POLL_INTERVAL_MS = 2000;

interface History {
  time: number[];
  cpu: number[];
  memPercent: number[];
  netRx: number[];
  netTx: number[];
}

const EMPTY_HISTORY: History = { time: [], cpu: [], memPercent: [], netRx: [], netTx: [] };

function push(history: History, snapshot: MonitorSnapshot, startedAt: number): History {
  const rx = snapshot.net.reduce((sum, n) => sum + n.rxBytesPerSec, 0);
  const tx = snapshot.net.reduce((sum, n) => sum + n.txBytesPerSec, 0);
  const memPercent =
    snapshot.mem.totalBytes > 0 ? (snapshot.mem.usedBytes / snapshot.mem.totalBytes) * 100 : 0;

  const trim = <T,>(arr: T[], value: T) =>
    arr.length >= HISTORY_LENGTH ? [...arr.slice(1), value] : [...arr, value];

  return {
    time: trim(history.time, (snapshot.takenAt - startedAt) / 1000),
    cpu: trim(history.cpu, snapshot.cpu.usagePercent),
    memPercent: trim(history.memPercent, memPercent),
    netRx: trim(history.netRx, rx),
    netTx: trim(history.netTx, tx),
  };
}

interface MonitorPanelProps {
  sessionId: string;
}

type SortField = 'pid' | 'user' | 'command' | 'cpu' | 'mem';
type SortOrder = 'asc' | 'desc';

const QUICK_PROCESS_FILTERS = [
  { label: 'Semua', query: '' },
  { label: 'PHP', query: 'php' },
  { label: 'Node', query: 'node' },
  { label: 'Python', query: 'python' },
  { label: 'Nginx', query: 'nginx' },
  { label: 'Docker', query: 'docker' },
  { label: 'DB', query: 'sql' },
];

export function MonitorPanel({ sessionId }: MonitorPanelProps) {
  const { t } = useI18n();
  const [snapshot, setSnapshot] = useState<MonitorSnapshot | null>(null);
  const [history, setHistory] = useState<History>(EMPTY_HISTORY);
  const [error, setError] = useState<string | null>(null);
  const startedAtRef = useRef(Date.now());

  // Process manager states
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('cpu');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;
  const [frozenProcesses, setFrozenProcesses] = useState<ProcessSample[]>([]);

  // Kill modal state
  const [targetProcess, setTargetProcess] = useState<ProcessSample | null>(null);
  const [killSignal, setKillSignal] = useState<'TERM' | 'KILL'>('TERM');
  const [sudoPassword, setSudoPassword] = useState('');
  const [needsSudo, setNeedsSudo] = useState(false);
  const [killBusy, setKillBusy] = useState(false);
  const [toast, setToast] = useState<{ message: string; isError: boolean } | null>(null);

  useEffect(() => {
    startedAtRef.current = Date.now();
    setSnapshot(null);
    setHistory(EMPTY_HISTORY);
    setError(null);

    const unsubscribeSnapshot = window.ssh.monitor.onSnapshot((payload) => {
      if (payload.sessionId !== sessionId) return;
      setSnapshot(payload.snapshot);
      setHistory((prev) => push(prev, payload.snapshot, startedAtRef.current));
      setError(null);
      if (!isPausedRef.current) {
        setFrozenProcesses(payload.snapshot.processes);
      }
    });

    const unsubscribeError = window.ssh.monitor.onError((payload) => {
      if (payload.sessionId === sessionId) setError(payload.message);
    });

    acquireMonitor(sessionId, POLL_INTERVAL_MS);

    return () => {
      unsubscribeSnapshot();
      unsubscribeError();
      releaseMonitor(sessionId);
    };
  }, [sessionId]);

  // Toast auto-clear
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const togglePause = () => {
    setIsPaused((prev) => {
      const next = !prev;
      if (next && snapshot) {
        setFrozenProcesses(snapshot.processes);
      }
      return next;
    });
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder(field === 'command' || field === 'user' ? 'asc' : 'desc');
    }
  };

  // Filtered & sorted processes
  const processesToDisplay = useMemo(() => {
    const list = isPaused ? frozenProcesses : (snapshot?.processes ?? []);
    let filtered = list;

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      filtered = list.filter(
        (p) =>
          String(p.pid).includes(q) ||
          p.user.toLowerCase().includes(q) ||
          p.command.toLowerCase().includes(q),
      );
    }

    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'pid':
          cmp = a.pid - b.pid;
          break;
        case 'user':
          cmp = a.user.localeCompare(b.user);
          break;
        case 'command':
          cmp = a.command.localeCompare(b.command);
          break;
        case 'cpu':
          cmp = a.cpuPercent - b.cpuPercent;
          break;
        case 'mem':
          cmp = a.memPercent - b.memPercent;
          break;
      }
      return sortOrder === 'desc' ? -cmp : cmp;
    });
  }, [isPaused, frozenProcesses, snapshot?.processes, search, sortField, sortOrder]);

  const openKillModal = (proc: ProcessSample) => {
    setTargetProcess(proc);
    setKillSignal('TERM');
    setSudoPassword('');
    setNeedsSudo(false);
  };

  const closeKillModal = () => {
    setTargetProcess(null);
    setNeedsSudo(false);
    setSudoPassword('');
  };

  const handleExecuteKill = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetProcess) return;

    setKillBusy(true);
    try {
      const res = await window.ssh.monitor.killProcess(
        sessionId,
        targetProcess.pid,
        killSignal,
        needsSudo ? sudoPassword : undefined,
      );

      if (res.success) {
        setToast({
          message: t('monitor.killSuccess', { signal: killSignal, pid: targetProcess.pid }),
          isError: false,
        });
        closeKillModal();
      } else if (res.message === 'PERMISSION_DENIED') {
        setNeedsSudo(true);
      } else {
        setToast({
          message: t('monitor.killFailed', { error: res.message || 'Unknown error' }),
          isError: true,
        });
      }
    } catch (err) {
      setToast({
        message: t('monitor.killFailed', { error: (err as Error).message }),
        isError: true,
      });
    } finally {
      setKillBusy(false);
    }
  };

  const cpuData = useMemo(
    () => [history.time, history.cpu, history.memPercent] as [number[], number[], number[]],
    [history],
  );
  const netData = useMemo(
    () => [history.time, history.netRx, history.netTx] as [number[], number[], number[]],
    [history],
  );

  const cpuSeries = useMemo(
    () => [
      { label: 'CPU', color: '#ff9700' },
      { label: t('monitor.memory'), color: '#b951ef' },
    ],
    [t],
  );

  const netSeries = useMemo(
    () => [
      { label: t('monitor.in'), color: '#58e879' },
      { label: t('monitor.out'), color: '#ffb52e' },
    ],
    [t],
  );

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <div>
          <p className="text-sm text-coral">{t('monitor.stopped')}</p>
          <p className="mt-2 max-w-md text-xs text-muted">{error}</p>
          <p className="mt-3 text-xs text-faint">{t('monitor.linuxOnly')}</p>
        </div>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-faint">
        {t('monitor.measuring')}
      </div>
    );
  }

  const memPercent = (snapshot.mem.usedBytes / snapshot.mem.totalBytes) * 100;
  const measuring = history.cpu.length < 2;

  return (
    <div className="aspro-monitor h-full overflow-y-auto bg-abyss p-3">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed bottom-5 right-5 z-[170] flex items-center gap-2 rounded-lg px-4 py-2.5 text-xs font-semibold shadow-xl transition-all ${
            toast.isError
              ? 'border border-coral/50 bg-surface text-coral shadow-coral/10'
              : 'border border-emerald-500/50 bg-surface text-emerald-400 shadow-emerald-500/10'
          }`}
        >
          <span>{toast.isError ? '⚠️' : '✓'}</span>
          <span>{toast.message}</span>
        </div>
      )}

      {/* Top summary cards */}
      <div className="aspro-monitor-summary mb-3 grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] text-faint">
        <span>
          {t('monitor.active')}{' '}
          <span className="text-dim">{formatUptime(snapshot.uptimeSeconds)}</span>
        </span>
        <span>
          {t('monitor.load')}{' '}
          <span className="font-mono text-dim">
            {snapshot.cpu.loadAvg.map((v) => v.toFixed(2)).join('  ')}
          </span>
        </span>
        <span>{t('monitor.cores', { count: snapshot.cpu.cores })}</span>
      </div>

      {/* Charts */}
      <div className="grid gap-3">
        <Card
          title={t('monitor.cpuMemory')}
          value={measuring ? t('monitor.measuring') : `${snapshot.cpu.usagePercent.toFixed(1)}%`}
          valueColor={measuring ? '#5b6275' : thresholdColor(snapshot.cpu.usagePercent)}
          legend={cpuSeries}
        >
          <Chart
            data={cpuData}
            series={cpuSeries}
            maxY={100}
            format={(v) => `${Math.round(v)}%`}
          />
        </Card>

        <Card
          title={t('monitor.network')}
          value={
            measuring
              ? t('monitor.measuring')
              : formatRate(snapshot.net.reduce((s, n) => s + n.rxBytesPerSec + n.txBytesPerSec, 0))
          }
          valueColor="#b951ef"
          legend={netSeries}
        >
          <Chart data={netData} series={netSeries} format={formatBytes} />
        </Card>
      </div>

      {/* Memory & Storage progress */}
      <section className="mt-2 grid gap-2 lg:grid-cols-2">
        <div className="aspro-monitor-card rounded-lg border border-line bg-panel p-3">
          <h3 className="mb-2 text-[11px] uppercase tracking-[0.14em] text-faint">
            {t('monitor.memory')}
          </h3>
          <Bar
            label="RAM"
            usedBytes={snapshot.mem.usedBytes}
            totalBytes={snapshot.mem.totalBytes}
            percent={memPercent}
          />
          {snapshot.mem.swapTotalBytes > 0 && (
            <div className="mt-3">
              <Bar
                label="Swap"
                usedBytes={snapshot.mem.swapUsedBytes}
                totalBytes={snapshot.mem.swapTotalBytes}
                percent={(snapshot.mem.swapUsedBytes / snapshot.mem.swapTotalBytes) * 100}
              />
            </div>
          )}
        </div>

        <div className="aspro-monitor-card rounded-lg border border-line bg-panel p-3">
          <h3 className="mb-2 text-[11px] uppercase tracking-[0.14em] text-faint">
            {t('monitor.storage')}
          </h3>
          <div className="space-y-3">
            {snapshot.disks.map((disk) => (
              <Bar
                key={disk.mount}
                label={disk.mount}
                usedBytes={disk.usedBytes}
                totalBytes={disk.totalBytes}
                percent={(disk.usedBytes / disk.totalBytes) * 100}
              />
            ))}
          </div>
        </div>
      </section>

      {/* Interactive Process Manager */}
      <section className="mt-2 rounded-lg border border-line bg-panel overflow-hidden shadow-sm">
        {/* Process Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface/40 px-3 py-2">
          <div className="flex items-center gap-2">
            <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
              {t('monitor.topProcesses')}
            </h3>
            <span className="rounded bg-line/60 px-1.5 py-0.5 text-[10px] font-medium text-faint">
              {t('monitor.processCount', {
                shown: processesToDisplay.length,
                total: snapshot.processes.length,
              })}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Quick Filter Chips */}
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5 max-w-full">
              {QUICK_PROCESS_FILTERS.map((f) => {
                const isActive =
                  (f.query === '' && search === '') ||
                  (f.query !== '' && search.toLowerCase() === f.query);
                return (
                  <button
                    key={f.label}
                    type="button"
                    onClick={() => setSearch(f.query)}
                    className={`rounded px-1.5 py-0.5 text-[10px] font-mono transition border ${
                      isActive
                        ? 'border-azure/50 bg-azure/15 text-azure font-semibold'
                        : 'border-line/60 bg-surface/60 text-faint hover:text-fg hover:border-line'
                    }`}
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>

            {/* Filter Search Input */}
            <div className="relative">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('monitor.filterPlaceholder')}
                className="aspro-input h-7 w-40 rounded-lg pl-6 pr-6 text-[11px] text-fg placeholder:text-faint focus:w-56 transition-all"
              />
              <span className="absolute left-2 top-1.5 text-[11px] text-faint">🔍</span>
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1.5 text-[10px] text-faint hover:text-fg"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Pause / Resume Button */}
            <button
              type="button"
              onClick={togglePause}
              title={isPaused ? t('monitor.resume') : t('monitor.pause')}
              className={`flex h-7 items-center gap-1.5 rounded-lg border px-2 text-[11px] font-medium transition ${
                isPaused
                  ? 'border-amber/50 bg-amber/15 text-amber hover:bg-amber/25'
                  : 'border-line/60 bg-surface text-dim hover:border-line hover:text-fg'
              }`}
            >
              <span>{isPaused ? '▶' : '⏸'}</span>
              <span className="hidden sm:inline">
                {isPaused ? t('monitor.resume') : t('monitor.pause')}
              </span>
            </button>
          </div>
        </div>

        {/* Process Table */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-[12px]">
            <thead>
              <tr className="border-b border-line/40 bg-surface/20 text-left text-faint text-[11px]">
                <th
                  onClick={() => handleSort('pid')}
                  className="cursor-pointer select-none px-3 py-2 font-semibold hover:text-fg"
                >
                  PID {sortField === 'pid' ? (sortOrder === 'asc' ? '▲' : '▼') : ''}
                </th>
                <th
                  onClick={() => handleSort('user')}
                  className="cursor-pointer select-none px-3 py-2 font-semibold hover:text-fg"
                >
                  {t('monitor.user')}{' '}
                  {sortField === 'user' ? (sortOrder === 'asc' ? '▲' : '▼') : ''}
                </th>
                <th
                  onClick={() => handleSort('command')}
                  className="cursor-pointer select-none px-3 py-2 font-semibold hover:text-fg"
                >
                  {t('monitor.command')}{' '}
                  {sortField === 'command' ? (sortOrder === 'asc' ? '▲' : '▼') : ''}
                </th>
                <th
                  onClick={() => handleSort('cpu')}
                  className="cursor-pointer select-none px-3 py-2 text-right font-semibold hover:text-fg"
                >
                  CPU {sortField === 'cpu' ? (sortOrder === 'asc' ? '▲' : '▼') : ''}
                </th>
                <th
                  onClick={() => handleSort('mem')}
                  className="cursor-pointer select-none px-3 py-2 text-right font-semibold hover:text-fg"
                >
                  {t('monitor.memory')}{' '}
                  {sortField === 'mem' ? (sortOrder === 'asc' ? '▲' : '▼') : ''}
                </th>
                <th className="px-3 py-2 text-right font-semibold w-24">Aksi</th>
              </tr>
            </thead>
            <tbody className="font-mono text-[11px]">
              {processesToDisplay.map((process) => (
                <tr
                  key={process.pid}
                  className="group border-t border-line/30 hover:bg-line/20 transition-colors"
                >
                  <td className="px-3 py-1.5 text-faint">{process.pid}</td>
                  <td className="px-3 py-1.5 text-muted">{process.user}</td>
                  <td
                    className="max-w-0 truncate px-3 py-1.5 text-dim font-sans"
                    title={process.command}
                  >
                    {process.command}
                  </td>
                  <td
                    className="px-3 py-1.5 text-right font-semibold"
                    style={{ color: thresholdColor(process.cpuPercent) }}
                  >
                    {process.cpuPercent.toFixed(1)}%
                  </td>
                  <td className="px-3 py-1.5 text-right text-muted">
                    {process.memPercent.toFixed(1)}%
                  </td>
                  <td className="px-3 py-1 text-right">
                    <button
                      type="button"
                      onClick={() => openKillModal(process)}
                      title={t('monitor.kill')}
                      className="rounded border border-coral/30 bg-coral/10 px-2 py-0.5 text-[10px] font-semibold text-coral opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-coral/25 transition-all"
                    >
                      {t('monitor.kill')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Kill Process Modal */}
      {targetProcess && (
        <div
          className="fixed inset-0 z-[160] flex items-center justify-center bg-black/80 p-3 sm:p-4 backdrop-blur-sm"
          onClick={closeKillModal}
          role="presentation"
        >
          <div
            className="w-full max-w-md max-h-[92vh] overflow-y-auto rounded-xl border border-line bg-surface p-4 sm:p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="flex items-center justify-between border-b border-line/50 pb-3">
              <h4 className="flex items-center gap-2 text-sm font-bold text-fg">
                <span className="text-coral">⚠️</span>
                <span>{t('monitor.killTitle', { pid: targetProcess.pid })}</span>
              </h4>
              <button
                type="button"
                onClick={closeKillModal}
                className="text-faint hover:text-fg text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={(e) => void handleExecuteKill(e)} className="mt-3 space-y-3">
              {/* Process info card */}
              <div className="rounded-lg border border-line/60 bg-raised/50 p-3 text-xs space-y-1.5">
                <div className="flex items-baseline justify-between text-faint">
                  <span>User: <strong className="text-fg">{targetProcess.user}</strong></span>
                  <span>CPU: <strong className="text-fg">{targetProcess.cpuPercent.toFixed(1)}%</strong> | RAM: <strong className="text-fg">{targetProcess.memPercent.toFixed(1)}%</strong></span>
                </div>
                <div className="font-mono text-[11px] text-dim break-all bg-surface/80 p-2 rounded border border-line/40 max-h-24 overflow-y-auto">
                  {targetProcess.command}
                </div>
              </div>

              {/* Signal selection */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">
                  {t('monitor.killDesc')}
                </label>
                <div className="space-y-1.5">
                  <label
                    className={`flex items-center gap-2 rounded-lg border p-2 text-xs cursor-pointer transition ${
                      killSignal === 'TERM'
                        ? 'border-azure bg-azure/10 text-fg'
                        : 'border-line/60 bg-surface/50 text-dim hover:text-fg'
                    }`}
                  >
                    <input
                      type="radio"
                      name="signal"
                      value="TERM"
                      checked={killSignal === 'TERM'}
                      onChange={() => setKillSignal('TERM')}
                      className="text-azure focus:ring-azure"
                    />
                    <span>{t('monitor.sigterm')}</span>
                  </label>

                  <label
                    className={`flex items-center gap-2 rounded-lg border p-2 text-xs cursor-pointer transition ${
                      killSignal === 'KILL'
                        ? 'border-coral bg-coral/10 text-fg'
                        : 'border-line/60 bg-surface/50 text-dim hover:text-fg'
                    }`}
                  >
                    <input
                      type="radio"
                      name="signal"
                      value="KILL"
                      checked={killSignal === 'KILL'}
                      onChange={() => setKillSignal('KILL')}
                      className="text-coral focus:ring-coral"
                    />
                    <span>{t('monitor.sigkill')}</span>
                  </label>
                </div>
              </div>

              {/* Sudo prompt if permission denied */}
              {needsSudo && (
                <div className="rounded-lg border border-amber/40 bg-amber/10 p-3 text-xs space-y-2">
                  <p className="text-amber font-medium">{t('monitor.sudoRequired')}</p>
                  <div>
                    <input
                      type="password"
                      autoFocus
                      required
                      value={sudoPassword}
                      onChange={(e) => setSudoPassword(e.target.value)}
                      placeholder={t('monitor.sudoPassword')}
                      className="aspro-input w-full px-3 py-1.5 text-xs text-fg"
                    />
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex justify-end gap-2 pt-2 border-t border-line/40">
                <button
                  type="button"
                  onClick={closeKillModal}
                  className="rounded-lg px-3 py-1.5 text-xs text-dim hover:text-fg"
                >
                  {t('project.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={killBusy}
                  className={`rounded-lg px-4 py-1.5 text-xs font-semibold text-abyss transition disabled:opacity-40 ${
                    needsSudo ? 'bg-amber hover:bg-amber/90' : 'bg-coral hover:bg-coral-bright'
                  }`}
                >
                  {killBusy
                    ? t('local.saving')
                    : needsSudo
                      ? t('monitor.killWithSudo')
                      : t('monitor.killConfirm')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function Card({
  title,
  value,
  valueColor,
  legend,
  children,
}: {
  title: string;
  value: string;
  valueColor: string;
  legend: Array<{ label: string; color: string }>;
  children: ReactNode;
}) {
  return (
    <div className="aspro-monitor-card rounded-lg border border-line bg-panel p-3">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-xs uppercase tracking-wider text-faint">{title}</h3>
        <span className="font-mono text-lg" style={{ color: valueColor }}>
          {value}
        </span>
      </div>
      {children}
      <div className="mt-2 flex gap-4 text-xs text-faint">
        {legend.map((item) => (
          <span key={item.label} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="h-0.5 w-3 rounded-full"
              style={{ backgroundColor: item.color }}
            />
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function Bar({
  label,
  usedBytes,
  totalBytes,
  percent,
}: {
  label: string;
  usedBytes: number;
  totalBytes: number;
  percent: number;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between text-xs">
        <span className="truncate font-mono text-dim">{label}</span>
        <span className="ml-3 shrink-0 font-mono text-faint">
          {formatBytes(usedBytes)} / {formatBytes(totalBytes)}
        </span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-active"
        role="progressbar"
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{
            width: `${Math.min(100, percent)}%`,
            backgroundColor: thresholdColor(percent),
          }}
        />
      </div>
    </div>
  );
}
