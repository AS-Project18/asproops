/**
 * Reference-count start/stop monitoring per session di sisi renderer.
 *
 * Backend monitor:start/stop dikaitkan ke SATU sessionId, tapi lebih dari
 * satu komponen bisa mau memantau session yang sama bersamaan (mis. panel
 * Monitor dan Dashboard multi-server sekaligus terbuka). Tanpa ref-count,
 * komponen yang unmount duluan akan mematikan polling yang komponen lain
 * masih butuhkan.
 */

const refCounts = new Map<string, number>();

export function acquireMonitor(sessionId: string, intervalMs?: number): void {
  const next = (refCounts.get(sessionId) ?? 0) + 1;
  refCounts.set(sessionId, next);
  if (next === 1) void window.ssh.monitor.start(sessionId, intervalMs);
}

export function releaseMonitor(sessionId: string): void {
  const next = (refCounts.get(sessionId) ?? 1) - 1;
  if (next <= 0) {
    refCounts.delete(sessionId);
    void window.ssh.monitor.stop(sessionId);
  } else {
    refCounts.set(sessionId, next);
  }
}
