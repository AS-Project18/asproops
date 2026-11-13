import * as net from 'node:net';
import { EventEmitter } from 'node:events';
import type { ConnectionManager, SessionPool } from './connection-manager';
import { tunnelStore } from '../store/tunnels';
import type {
  SshTunnel,
  SshTunnelRuntimeStatus,
} from '../../src/shared/types';

interface ActiveTunnel {
  tunnel: SshTunnel;
  server?: net.Server;
  sockets: Set<net.Socket>;
  connectionsCount: number;
  bytesTransferred: number;
  state: 'active' | 'inactive' | 'error';
  error?: string;
  cleanupRemote?: () => Promise<void>;
}

export class TunnelManager extends EventEmitter {
  private activeTunnels = new Map<string, ActiveTunnel>();

  constructor(private connections: ConnectionManager) {
    super();
  }

  getStatus(tunnelId: string): SshTunnelRuntimeStatus {
    const active = this.activeTunnels.get(tunnelId);
    if (!active) {
      return {
        id: tunnelId,
        state: 'inactive',
        connectionsCount: 0,
        bytesTransferred: 0,
      };
    }
    return {
      id: tunnelId,
      state: active.state,
      error: active.error,
      connectionsCount: active.connectionsCount,
      bytesTransferred: active.bytesTransferred,
    };
  }

  getAllStatuses(): Record<string, SshTunnelRuntimeStatus> {
    const result: Record<string, SshTunnelRuntimeStatus> = {};
    for (const [id, active] of this.activeTunnels.entries()) {
      result[id] = {
        id,
        state: active.state,
        error: active.error,
        connectionsCount: active.connectionsCount,
        bytesTransferred: active.bytesTransferred,
      };
    }
    return result;
  }

  private emitStatusChange(tunnelId: string): void {
    this.emit('status', this.getStatus(tunnelId));
  }

  async start(tunnelId: string): Promise<void> {
    const tunnel = tunnelStore.get(tunnelId);
    if (!tunnel) {
      throw new Error(`Tunnel dengan id "${tunnelId}" tidak ditemukan.`);
    }

    // Stop if already running
    if (this.activeTunnels.has(tunnelId)) {
      await this.stop(tunnelId);
    }

    const pool = this.connections.get(tunnel.sessionId);
    if (!pool || pool.getStatus() !== 'connected') {
      const active: ActiveTunnel = {
        tunnel,
        sockets: new Set(),
        connectionsCount: 0,
        bytesTransferred: 0,
        state: 'error',
        error: 'Sesi SSH belum terhubung.',
      };
      this.activeTunnels.set(tunnelId, active);
      this.emitStatusChange(tunnelId);
      throw new Error('Sesi SSH belum terhubung.');
    }

    const active: ActiveTunnel = {
      tunnel,
      sockets: new Set(),
      connectionsCount: 0,
      bytesTransferred: 0,
      state: 'inactive',
    };
    this.activeTunnels.set(tunnelId, active);

    try {
      if (tunnel.type === 'local') {
        await this.startLocalTunnel(active, pool);
      } else if (tunnel.type === 'remote') {
        await this.startRemoteTunnel(active, pool);
      } else if (tunnel.type === 'dynamic') {
        await this.startDynamicTunnel(active, pool);
      }
      active.state = 'active';
      active.error = undefined;
      this.emitStatusChange(tunnelId);
    } catch (err) {
      active.state = 'error';
      active.error = (err as Error).message;
      this.emitStatusChange(tunnelId);
      throw err;
    }
  }

  private startLocalTunnel(active: ActiveTunnel, pool: SessionPool): Promise<void> {
    return new Promise((resolve, reject) => {
      const { tunnel } = active;
      const server = net.createServer((socket) => {
        active.sockets.add(socket);
        active.connectionsCount += 1;
        this.emitStatusChange(tunnel.id);

        pool
          .forwardOut(tunnel.remoteHost, tunnel.remotePort)
          .then((channel) => {
            socket.on('data', (chunk) => {
              active.bytesTransferred += chunk.length;
            });
            channel.on('data', (chunk: Buffer) => {
              active.bytesTransferred += chunk.length;
            });

            socket.pipe(channel);
            channel.pipe(socket);

            const cleanup = () => {
              socket.destroy();
              channel.end();
              active.sockets.delete(socket);
            };

            socket.on('error', cleanup);
            channel.on('error', cleanup);
            socket.on('close', () => {
              active.sockets.delete(socket);
            });
          })
          .catch((err) => {
            console.error(`ForwardOut error untuk tunnel ${tunnel.name}:`, err);
            socket.destroy();
            active.sockets.delete(socket);
          });
      });

      server.once('error', (err) => {
        reject(err);
      });

      server.listen(tunnel.localPort, tunnel.localHost, () => {
        active.server = server;
        resolve();
      });
    });
  }

  private startRemoteTunnel(active: ActiveTunnel, pool: SessionPool): Promise<void> {
    return new Promise((resolve, reject) => {
      const { tunnel } = active;
      const primary = pool.primary;
      if (!primary) {
        return reject(new Error('Koneksi primary SSH tidak tersedia.'));
      }

      primary
        .forwardIn('127.0.0.1', tunnel.remotePort)
        .then(() => {
          const onTcp = (
            details: { destPort: number },
            accept: () => any,
            rejectConn: () => void,
          ) => {
            if (details.destPort === tunnel.remotePort) {
              active.connectionsCount += 1;
              this.emitStatusChange(tunnel.id);

              const stream = accept();
              const localSocket = net.connect(tunnel.localPort, tunnel.localHost);
              active.sockets.add(localSocket);

              localSocket.on('data', (chunk) => {
                active.bytesTransferred += chunk.length;
              });
              stream.on('data', (chunk: Buffer) => {
                active.bytesTransferred += chunk.length;
              });

              localSocket.pipe(stream);
              stream.pipe(localSocket);

              const cleanup = () => {
                localSocket.destroy();
                stream.end();
                active.sockets.delete(localSocket);
              };

              localSocket.on('error', cleanup);
              stream.on('error', cleanup);
              localSocket.on('close', () => {
                active.sockets.delete(localSocket);
              });
            } else {
              rejectConn();
            }
          };

          primary.on('tcpConnection', onTcp);

          active.cleanupRemote = async () => {
            primary.removeListener('tcpConnection', onTcp);
            await primary.unforwardIn('127.0.0.1', tunnel.remotePort).catch(() => {});
          };

          resolve();
        })
        .catch(reject);
    });
  }

  private startDynamicTunnel(active: ActiveTunnel, pool: SessionPool): Promise<void> {
    return new Promise((resolve, reject) => {
      const { tunnel } = active;
      const server = net.createServer((socket) => {
        active.sockets.add(socket);
        active.connectionsCount += 1;
        this.emitStatusChange(tunnel.id);

        let stage = 0; // 0: greeting, 1: connect request, 2: connected

        socket.on('data', (data) => {
          if (stage === 0) {
            // SOCKS5 Greeting: 0x05 NMETHODS METHODS
            if (data[0] !== 0x05) {
              socket.destroy();
              return;
            }
            // Response: 0x05 0x00 (NO AUTH REQUIRED)
            socket.write(Buffer.from([0x05, 0x00]));
            stage = 1;
            return;
          }

          if (stage === 1) {
            // SOCKS5 Request: 0x05 CMD(0x01) RSV ATYP DST.ADDR DST.PORT
            if (data[0] !== 0x05 || data[1] !== 0x01) {
              socket.destroy();
              return;
            }

            const atyp = data[3];
            let destHost = '';
            let portOffset = 4;

            if (atyp === 0x01) {
              // IPv4
              destHost = `${data[4]}.${data[5]}.${data[6]}.${data[7]}`;
              portOffset = 8;
            } else if (atyp === 0x03) {
              // Domain name: 1 byte length + ASCII chars
              const len = data[4];
              destHost = data.subarray(5, 5 + len).toString('utf8');
              portOffset = 5 + len;
            } else if (atyp === 0x04) {
              // IPv6 (16 bytes)
              const parts: string[] = [];
              for (let i = 0; i < 16; i += 2) {
                parts.push(data.readUInt16BE(4 + i).toString(16));
              }
              destHost = parts.join(':');
              portOffset = 20;
            } else {
              socket.destroy();
              return;
            }

            const destPort = data.readUInt16BE(portOffset);
            stage = 2;

            // Connect via SSH forwardOut
            pool
              .forwardOut(destHost, destPort)
              .then((channel) => {
                // Reply success: 0x05 0x00 0x00 0x01 0 0 0 0 0 0
                socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));

                socket.on('data', (chunk) => {
                  active.bytesTransferred += chunk.length;
                });
                channel.on('data', (chunk: Buffer) => {
                  active.bytesTransferred += chunk.length;
                });

                socket.pipe(channel);
                channel.pipe(socket);

                const cleanup = () => {
                  socket.destroy();
                  channel.end();
                  active.sockets.delete(socket);
                };

                socket.on('error', cleanup);
                channel.on('error', cleanup);
                socket.on('close', () => {
                  active.sockets.delete(socket);
                });
              })
              .catch((err) => {
                console.error(`SOCKS5 forwardOut failed ke ${destHost}:${destPort}:`, err);
                // Reply: 0x05 0x05 (Connection refused)
                socket.write(Buffer.from([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
                socket.destroy();
                active.sockets.delete(socket);
              });
          }
        });

        socket.on('error', () => {
          socket.destroy();
          active.sockets.delete(socket);
        });
        socket.on('close', () => {
          active.sockets.delete(socket);
        });
      });

      server.once('error', (err) => {
        reject(err);
      });

      server.listen(tunnel.localPort, tunnel.localHost, () => {
        active.server = server;
        resolve();
      });
    });
  }

  async stop(tunnelId: string): Promise<void> {
    const active = this.activeTunnels.get(tunnelId);
    if (!active) return;

    // Close all open sockets
    for (const socket of active.sockets) {
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
    }
    active.sockets.clear();

    // Close local server if any
    if (active.server) {
      await new Promise<void>((resolve) => {
        active.server?.close(() => resolve());
      });
      active.server = undefined;
    }

    // Cleanup remote forward if any
    if (active.cleanupRemote) {
      await active.cleanupRemote().catch(() => {});
      active.cleanupRemote = undefined;
    }

    active.state = 'inactive';
    active.error = undefined;
    this.activeTunnels.delete(tunnelId);
    this.emitStatusChange(tunnelId);
  }

  async stopAllForSession(sessionId: string): Promise<void> {
    const toStop: string[] = [];
    for (const [id, active] of this.activeTunnels.entries()) {
      if (active.tunnel.sessionId === sessionId) {
        toStop.push(id);
      }
    }
    await Promise.all(toStop.map((id) => this.stop(id)));
  }

  async startAutoTunnels(sessionId: string): Promise<void> {
    const tunnels = tunnelStore.list(sessionId);
    for (const tunnel of tunnels) {
      if (tunnel.autoStart) {
        try {
          await this.start(tunnel.id);
        } catch (err) {
          console.error(`Gagal auto-start tunnel ${tunnel.name}:`, err);
        }
      }
    }
  }
}
