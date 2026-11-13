import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { app } from 'electron';

import type {
  SshTunnel,
  SshTunnelCreateInput,
  SshTunnelUpdatePatch,
} from '../../src/shared/types';

interface StoreFile {
  version: 1;
  tunnels: SshTunnel[];
}

const EMPTY: StoreFile = {
  version: 1,
  tunnels: [],
};

export class TunnelStore {
  private readonly path: string;
  private data: StoreFile;

  constructor(filePath?: string) {
    this.path = filePath ?? join(app.getPath('userData'), 'tunnels.json');
    this.data = this.load();
  }

  private load(): StoreFile {
    try {
      const raw = readFileSync(this.path, 'utf8');
      const parsed = JSON.parse(raw) as Partial<StoreFile>;
      if (parsed.version !== 1 || !Array.isArray(parsed.tunnels)) {
        throw new Error('Format tunnels.json tidak cocok.');
      }
      return {
        version: 1,
        tunnels: parsed.tunnels,
      };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        const initial = { ...EMPTY };
        try {
          mkdirSync(dirname(this.path), { recursive: true });
          writeFileSync(this.path, JSON.stringify(initial, null, 2), {
            encoding: 'utf8',
            mode: 0o600,
          });
        } catch {
          // Abaikan jika tidak bisa menulis berkas awal
        }
        return initial;
      }

      const backup = `${this.path}.corrupt-${Date.now()}`;
      try {
        renameSync(this.path, backup);
        console.error(`tunnels.json rusak, disisihkan ke ${backup}`);
      } catch {
        /* jika gagal dipindahkan */
      }
      return { ...EMPTY };
    }
  }

  private flush(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const temp = `${this.path}.tmp`;
    writeFileSync(temp, JSON.stringify(this.data, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
    renameSync(temp, this.path);
  }

  list(sessionId?: string): SshTunnel[] {
    const list = sessionId
      ? this.data.tunnels.filter((t) => t.sessionId === sessionId)
      : this.data.tunnels;
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }

  get(id: string): SshTunnel | undefined {
    return this.data.tunnels.find((t) => t.id === id);
  }

  create(input: SshTunnelCreateInput): SshTunnel {
    const now = Date.now();
    const tunnel: SshTunnel = {
      id: randomUUID(),
      sessionId: input.sessionId,
      name: input.name.trim() || `Tunnel ${input.localPort}`,
      type: input.type,
      localHost: input.localHost?.trim() || '127.0.0.1',
      localPort: input.localPort,
      remoteHost: input.remoteHost?.trim() || '127.0.0.1',
      remotePort: input.remotePort || input.localPort,
      autoStart: Boolean(input.autoStart),
      createdAt: now,
      updatedAt: now,
    };
    this.data.tunnels.push(tunnel);
    this.flush();
    return tunnel;
  }

  update(id: string, patch: SshTunnelUpdatePatch): SshTunnel | undefined {
    const tunnel = this.data.tunnels.find((t) => t.id === id);
    if (!tunnel) return undefined;

    if (patch.name !== undefined) tunnel.name = patch.name.trim();
    if (patch.type !== undefined) tunnel.type = patch.type;
    if (patch.localHost !== undefined) tunnel.localHost = patch.localHost.trim() || '127.0.0.1';
    if (patch.localPort !== undefined) tunnel.localPort = patch.localPort;
    if (patch.remoteHost !== undefined) tunnel.remoteHost = patch.remoteHost.trim() || '127.0.0.1';
    if (patch.remotePort !== undefined) tunnel.remotePort = patch.remotePort;
    if (patch.autoStart !== undefined) tunnel.autoStart = patch.autoStart;
    tunnel.updatedAt = Date.now();

    this.flush();
    return tunnel;
  }

  remove(id: string): void {
    this.data.tunnels = this.data.tunnels.filter((t) => t.id !== id);
    this.flush();
  }

  removeBySession(sessionId: string): void {
    this.data.tunnels = this.data.tunnels.filter((t) => t.sessionId !== sessionId);
    this.flush();
  }
}

export const tunnelStore = new TunnelStore();
