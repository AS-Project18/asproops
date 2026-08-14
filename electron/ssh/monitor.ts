import type { SessionChannels } from './connection-manager';
import type {
  DiskSample,
  MonitorSnapshot,
  NetSample,
  ProcessSample,
} from '../../src/shared/types';

/**
 * Monitor server dengan satu perintah per polling.
 *
 * Membaca /proc langsung, bukan parsing `top`, karena format `top` berbeda
 * antar distro dan antar versi procps. /proc stabil di semua Linux.
 */

const SECTION = '@@';

const COLLECT_COMMAND = [
  `__s(){ printf '\\n${SECTION}%s${SECTION}\\n' "$1"; }`,
  '__s CPU; cat /proc/stat',
  '__s MEM; cat /proc/meminfo',
  '__s NET; cat /proc/net/dev',
  '__s UPTIME; cat /proc/uptime',
  '__s LOAD; cat /proc/loadavg',
  '__s DISK; df -B1 -P -x tmpfs -x devtmpfs -x squashfs 2>/dev/null',
  '__s PROC; ps -eo pid,user:20,pcpu,pmem,comm --sort=-pcpu 2>/dev/null | head -n 16',
].join('; ');

interface CpuTotals {
  idle: number;
  total: number;
}

interface NetTotals {
  rxBytes: number;
  txBytes: number;
}

interface PreviousSample {
  takenAt: number;
  cpu: CpuTotals;
  net: Map<string, NetTotals>;
}

function splitSections(stdout: string): Map<string, string> {
  const sections = new Map<string, string>();
  const parts = stdout.split(new RegExp(`\\n?${SECTION}(\\w+)${SECTION}\\n`));
  // parts[0] adalah teks sebelum section pertama (biasanya kosong).
  for (let i = 1; i < parts.length; i += 2) {
    sections.set(parts[i], parts[i + 1] ?? '');
  }
  return sections;
}

function parseCpuTotals(procStat: string): { totals: CpuTotals; cores: number } {
  const lines = procStat.split('\n');
  const aggregate = lines.find((l) => l.startsWith('cpu '));
  if (!aggregate) throw new Error('Baris agregat cpu tidak ditemukan di /proc/stat.');

  // user nice system idle iowait irq softirq steal guest guest_nice
  const values = aggregate.trim().split(/\s+/).slice(1).map(Number);
  const idle = (values[3] ?? 0) + (values[4] ?? 0);
  const total = values.reduce((sum, v) => sum + v, 0);

  const cores = lines.filter((l) => /^cpu\d+\s/.test(l)).length;
  return { totals: { idle, total }, cores: cores || 1 };
}

function parseMeminfo(meminfo: string) {
  const values = new Map<string, number>();
  for (const line of meminfo.split('\n')) {
    const match = line.match(/^(\w+):\s+(\d+)\s*kB/);
    if (match) values.set(match[1], Number(match[2]) * 1024);
  }

  const total = values.get('MemTotal') ?? 0;
  // MemAvailable jauh lebih akurat daripada MemFree: page cache yang bisa
  // direklaim tidak dihitung sebagai "terpakai".
  const available = values.get('MemAvailable') ?? values.get('MemFree') ?? 0;
  const swapTotal = values.get('SwapTotal') ?? 0;
  const swapFree = values.get('SwapFree') ?? 0;

  return {
    totalBytes: total,
    availableBytes: available,
    usedBytes: total - available,
    swapTotalBytes: swapTotal,
    swapUsedBytes: swapTotal - swapFree,
  };
}

function parseNetTotals(procNetDev: string): Map<string, NetTotals> {
  const result = new Map<string, NetTotals>();
  for (const line of procNetDev.split('\n').slice(2)) {
    const [ifacePart, rest] = line.split(':');
    if (!rest) continue;
    const iface = ifacePart.trim();
    if (iface === 'lo') continue;

    const fields = rest.trim().split(/\s+/).map(Number);
    result.set(iface, { rxBytes: fields[0] ?? 0, txBytes: fields[8] ?? 0 });
  }
  return result;
}

function parseDisks(df: string): DiskSample[] {
  return df
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((f) => f.length >= 6)
    .map((f) => ({
      filesystem: f[0],
      totalBytes: Number(f[1]),
      usedBytes: Number(f[2]),
      mount: f[5],
    }))
    .filter((d) => d.totalBytes > 0);
}

function parseProcesses(ps: string): ProcessSample[] {
  return ps
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((f) => f.length >= 5)
    .map((f) => ({
      pid: Number(f[0]),
      user: f[1],
      cpuPercent: Number(f[2]),
      memPercent: Number(f[3]),
      command: f.slice(4).join(' '),
    }));
}

export class RemoteMonitor {
  private readonly previous = new Map<string, PreviousSample>();
  private readonly timers = new Map<string, NodeJS.Timeout>();

  /**
   * Snapshot pertama untuk sebuah session hanya menghasilkan CPU 0% dan
   * network 0 B/s — nilai delta baru bermakna pada polling kedua.
   */
  async sample(sessionId: string, connection: SessionChannels): Promise<MonitorSnapshot> {
    const { stdout } = await connection.exec(COLLECT_COMMAND);
    const sections = splitSections(stdout);
    const takenAt = Date.now();

    const { totals: cpuTotals, cores } = parseCpuTotals(sections.get('CPU') ?? '');
    const netTotals = parseNetTotals(sections.get('NET') ?? '');
    const prev = this.previous.get(sessionId);

    let usagePercent = 0;
    if (prev) {
      const totalDelta = cpuTotals.total - prev.cpu.total;
      const idleDelta = cpuTotals.idle - prev.cpu.idle;
      if (totalDelta > 0) {
        usagePercent = ((totalDelta - idleDelta) / totalDelta) * 100;
      }
    }

    const elapsedSeconds = prev ? (takenAt - prev.takenAt) / 1000 : 0;
    const net: NetSample[] = [];
    for (const [iface, totals] of netTotals) {
      const before = prev?.net.get(iface);
      net.push({
        iface,
        rxBytesPerSec:
          before && elapsedSeconds > 0 ? (totals.rxBytes - before.rxBytes) / elapsedSeconds : 0,
        txBytesPerSec:
          before && elapsedSeconds > 0 ? (totals.txBytes - before.txBytes) / elapsedSeconds : 0,
      });
    }

    this.previous.set(sessionId, { takenAt, cpu: cpuTotals, net: netTotals });

    const loadFields = (sections.get('LOAD') ?? '').trim().split(/\s+/).map(Number);

    return {
      takenAt,
      uptimeSeconds: Number((sections.get('UPTIME') ?? '0').trim().split(/\s+/)[0]),
      cpu: {
        usagePercent: Math.max(0, Math.min(100, usagePercent)),
        cores,
        loadAvg: [loadFields[0] ?? 0, loadFields[1] ?? 0, loadFields[2] ?? 0],
      },
      mem: parseMeminfo(sections.get('MEM') ?? ''),
      disks: parseDisks(sections.get('DISK') ?? ''),
      net,
      processes: parseProcesses(sections.get('PROC') ?? ''),
    };
  }

  start(
    sessionId: string,
    connection: SessionChannels,
    intervalMs: number,
    onSnapshot: (snapshot: MonitorSnapshot) => void,
    onError: (error: Error) => void,
  ): void {
    this.stop(sessionId);

    let inFlight = false;
    const tick = async () => {
      // Kalau server lambat, jangan menumpuk permintaan di antrean.
      if (inFlight) return;
      inFlight = true;
      try {
        onSnapshot(await this.sample(sessionId, connection));
      } catch (err) {
        onError(err as Error);
      } finally {
        inFlight = false;
      }
    };

    void tick();
    this.timers.set(sessionId, setInterval(tick, intervalMs));
  }

  stop(sessionId: string): void {
    const timer = this.timers.get(sessionId);
    if (timer) clearInterval(timer);
    this.timers.delete(sessionId);
    this.previous.delete(sessionId);
  }
}
