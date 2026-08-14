import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MonitorSnapshot } from '../shared/types';
import { Chart } from './Chart';
import { formatBytes, formatRate, formatUptime, thresholdColor } from '../lib/format';
import { useI18n } from '../i18n';

/**
 * Panel monitor server.
 *
 * Riwayat disimpan di renderer, bukan di proses main, karena datanya murni
 * untuk tampilan dan tidak perlu bertahan setelah panel ditutup.
 */

/** 150 titik pada interval 2 detik ≈ 5 menit riwayat. */
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

export function MonitorPanel({ sessionId }: MonitorPanelProps) {
  const { t } = useI18n();
  const [snapshot, setSnapshot] = useState<MonitorSnapshot | null>(null);
  const [history, setHistory] = useState<History>(EMPTY_HISTORY);
  const [error, setError] = useState<string | null>(null);
  const startedAtRef = useRef(Date.now());

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
    });

    const unsubscribeError = window.ssh.monitor.onError((payload) => {
      if (payload.sessionId === sessionId) setError(payload.message);
    });

    void window.ssh.monitor.start(sessionId, POLL_INTERVAL_MS);

    return () => {
      unsubscribeSnapshot();
      unsubscribeError();
      void window.ssh.monitor.stop(sessionId);
    };
  }, [sessionId]);

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
          <p className="mt-3 text-xs text-faint">
            {t('monitor.linuxOnly')}
          </p>
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
  // Pembacaan pertama tidak punya pembanding, jadi CPU selalu 0% di titik itu.
  const measuring = history.cpu.length < 2;

  return (
    <div className="aspro-monitor h-full overflow-y-auto bg-abyss p-3">
      <div className="aspro-monitor-summary mb-3 grid grid-cols-3 gap-2 text-[9px] text-faint">
        <span>
          {t('monitor.active')} <span className="text-dim">{formatUptime(snapshot.uptimeSeconds)}</span>
        </span>
        <span>
          {t('monitor.load')}{' '}
          <span className="font-mono text-dim">
            {snapshot.cpu.loadAvg.map((v) => v.toFixed(2)).join('  ')}
          </span>
        </span>
        <span>
          {t('monitor.cores', { count: snapshot.cpu.cores })}
        </span>
      </div>

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

      <section className="mt-2 grid gap-2 2xl:grid-cols-2">
        <div className="aspro-monitor-card rounded-lg border border-line bg-panel p-3">
          <h3 className="mb-2 text-[9px] uppercase tracking-[0.14em] text-faint">{t('monitor.memory')}</h3>
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
          <h3 className="mb-2 text-[9px] uppercase tracking-[0.14em] text-faint">{t('monitor.storage')}</h3>
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

      <section className="mt-2 rounded-lg border border-line bg-panel">
        <h3 className="border-b border-line px-3 py-2 text-[9px] uppercase tracking-[0.14em] text-faint">
          {t('monitor.topProcesses')}
        </h3>
        <div className="overflow-x-auto"><table className="w-full min-w-[420px] text-[10px]">
          <thead>
            <tr className="text-left text-faint">
              <th className="px-4 py-2 font-normal">PID</th>
              <th className="px-4 py-2 font-normal">{t('monitor.user')}</th>
              <th className="px-4 py-2 font-normal">{t('monitor.command')}</th>
              <th className="px-4 py-2 text-right font-normal">CPU</th>
              <th className="px-4 py-2 text-right font-normal">{t('monitor.memory')}</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {snapshot.processes.map((process) => (
              <tr key={process.pid} className="border-t border-active">
                <td className="px-4 py-1.5 text-faint">{process.pid}</td>
                <td className="px-4 py-1.5 text-muted">{process.user}</td>
                <td className="max-w-0 truncate px-4 py-1.5 text-dim">{process.command}</td>
                <td
                  className="px-4 py-1.5 text-right"
                  style={{ color: thresholdColor(process.cpuPercent) }}
                >
                  {process.cpuPercent.toFixed(1)}%
                </td>
                <td className="px-4 py-1.5 text-right text-muted">
                  {process.memPercent.toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </section>
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
