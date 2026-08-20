import { randomUUID } from 'node:crypto';
import net from 'node:net';
import type { Duplex } from 'node:stream';
import type { AcceptConnection, ClientChannel, RejectConnection, TcpConnectionDetails } from 'ssh2';

import type { SessionPool } from './connection-manager';
import type { PortForwardRule, PortForwardStatus } from '../../src/shared/types';

/**
 * Tunnel port forwarding SSH yang sedang berjalan.
 *
 * local: listener TCP dibuka di sini (di komputer pengguna); setiap koneksi
 * masuk membuka satu channel forwardOut baru ke server — model yang sama
 * dipakai `ssh -L`.
 *
 * remote: server yang membuka listener (lewat forwardIn); koneksi masuk
 * datang sebagai event 'tcp connection' pada SshConnection yang sama,
 * disaring lewat destPort karena event itu global per-koneksi (bukan
 * per-forwardIn) — model yang sama dipakai `ssh -R`.
 */

interface ActiveTunnel {
  tunnelId: string;
  ruleId: string;
  sessionId: string;
  cleanup: () => void;
}

/** Sambungkan dua arah lalu putuskan keduanya begitu salah satu berhenti. */
function pipeBoth(a: Duplex, b: Duplex): void {
  a.pipe(b);
  b.pipe(a);
  const closeBoth = () => {
    a.destroy();
    b.destroy();
  };
  a.on('error', closeBoth);
  b.on('error', closeBoth);
  a.on('close', closeBoth);
  b.on('close', closeBoth);
}

export class PortForwardManager {
  private readonly tunnels = new Map<string, ActiveTunnel>();

  constructor(private readonly onStatus: (status: PortForwardStatus) => void) {}

  private emitStatus(tunnel: Pick<ActiveTunnel, 'tunnelId' | 'ruleId' | 'sessionId'>, state: PortForwardStatus['state'], message?: string): void {
    this.onStatus({ tunnelId: tunnel.tunnelId, ruleId: tunnel.ruleId, sessionId: tunnel.sessionId, state, message });
  }

  async start(pool: SessionPool, rule: PortForwardRule): Promise<string> {
    const tunnelId = randomUUID();
    if (rule.direction === 'local') {
      await this.startLocal(tunnelId, pool, rule);
    } else {
      await this.startRemote(tunnelId, pool, rule);
    }
    return tunnelId;
  }

  private async startLocal(tunnelId: string, pool: SessionPool, rule: PortForwardRule): Promise<void> {
    const server = net.createServer((socket) => {
      void pool
        .forwardOut(rule.remoteHost, rule.remotePort)
        .then((channel: ClientChannel) => pipeBoth(socket, channel))
        .catch(() => socket.destroy());
    });

    server.on('error', (err) => {
      this.emitStatus({ tunnelId, ruleId: rule.id, sessionId: rule.sessionId }, 'error', err.message);
      this.tunnels.delete(tunnelId);
      server.close();
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(rule.localPort, rule.localHost || '127.0.0.1', () => {
        server.removeListener('error', reject);
        resolve();
      });
    });

    this.tunnels.set(tunnelId, {
      tunnelId,
      ruleId: rule.id,
      sessionId: rule.sessionId,
      cleanup: () => server.close(),
    });
    this.emitStatus({ tunnelId, ruleId: rule.id, sessionId: rule.sessionId }, 'active');
  }

  private async startRemote(tunnelId: string, pool: SessionPool, rule: PortForwardRule): Promise<void> {
    const connection = pool.primary;
    if (!connection) throw new Error('Tidak ada koneksi SSH aktif untuk membuka remote forward.');

    const bindAddr = rule.remoteHost || '0.0.0.0';
    await connection.forwardIn(bindAddr, rule.remotePort);

    const onTcpConnection = (
      details: TcpConnectionDetails,
      accept: AcceptConnection<ClientChannel>,
      reject: RejectConnection,
    ) => {
      if (details.destPort !== rule.remotePort) return;

      const socket = net.connect(rule.localPort, rule.localHost || '127.0.0.1');
      socket.on('error', () => reject());
      socket.on('connect', () => {
        const channel = accept();
        pipeBoth(socket, channel);
      });
    };

    connection.on('tcpConnection', onTcpConnection);

    this.tunnels.set(tunnelId, {
      tunnelId,
      ruleId: rule.id,
      sessionId: rule.sessionId,
      cleanup: () => {
        connection.removeListener('tcpConnection', onTcpConnection);
        void connection.unforwardIn(bindAddr, rule.remotePort).catch(() => {
          /* koneksi mungkin sudah putus — tidak ada yang bisa dilepas */
        });
      },
    });
    this.emitStatus({ tunnelId, ruleId: rule.id, sessionId: rule.sessionId }, 'active');
  }

  stop(tunnelId: string): void {
    const tunnel = this.tunnels.get(tunnelId);
    if (!tunnel) return;
    tunnel.cleanup();
    this.tunnels.delete(tunnelId);
    this.emitStatus(tunnel, 'closed');
  }

  list(sessionId: string): PortForwardStatus[] {
    return [...this.tunnels.values()]
      .filter((t) => t.sessionId === sessionId)
      .map((t) => ({ tunnelId: t.tunnelId, ruleId: t.ruleId, sessionId: t.sessionId, state: 'active' as const }));
  }

  stopForSession(sessionId: string): void {
    for (const tunnel of [...this.tunnels.values()]) {
      if (tunnel.sessionId === sessionId) this.stop(tunnel.tunnelId);
    }
  }

  stopAll(): void {
    for (const tunnelId of [...this.tunnels.keys()]) this.stop(tunnelId);
  }
}
