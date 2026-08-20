import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { app } from 'electron';

import type { PortForwardRule } from '../../src/shared/types';

/**
 * Aturan port forwarding tersimpan (nama, arah, host/port lokal & remote) —
 * bukan status tunnel yang sedang berjalan, itu murni in-memory di
 * PortForwardManager. Pola sama dengan ProjectStore: satu berkas JSON,
 * ditulis lewat berkas sementara supaya tidak ada tulisan setengah jadi.
 * Tidak ada kredensial di sini, jadi tidak perlu enkripsi seperti sessions.json.
 */

interface StoreFile {
  version: 1;
  rules: PortForwardRule[];
}

const EMPTY: StoreFile = { version: 1, rules: [] };

export class PortForwardStore {
  private readonly path: string;
  private data: StoreFile;

  constructor(path = join(app.getPath('userData'), 'port-forwards.json')) {
    this.path = path;
    this.data = this.read();
  }

  private read(): StoreFile {
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as StoreFile;
      if (!Array.isArray(parsed.rules)) return { ...EMPTY };
      return parsed;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return { ...EMPTY };
      const backup = `${this.path}.corrupt-${Date.now()}`;
      try {
        renameSync(this.path, backup);
        console.error(`port-forwards.json tidak terbaca, disisihkan ke ${backup}`);
      } catch {
        /* kalau pemindahan pun gagal, tidak ada yang bisa diselamatkan */
      }
      return { ...EMPTY };
    }
  }

  private flush(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const temp = `${this.path}.tmp`;
    writeFileSync(temp, JSON.stringify(this.data, null, 2), { encoding: 'utf8', mode: 0o600 });
    renameSync(temp, this.path);
  }

  list(sessionId: string): PortForwardRule[] {
    return this.data.rules
      .filter((r) => r.sessionId === sessionId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  get(id: string): PortForwardRule | undefined {
    return this.data.rules.find((r) => r.id === id);
  }

  create(
    sessionId: string,
    input: Pick<
      PortForwardRule,
      'name' | 'direction' | 'localHost' | 'localPort' | 'remoteHost' | 'remotePort'
    >,
  ): PortForwardRule {
    const rule: PortForwardRule = {
      id: randomUUID(),
      sessionId,
      ...input,
      createdAt: Date.now(),
    };
    this.data.rules.push(rule);
    this.flush();
    return rule;
  }

  update(id: string, patch: Partial<PortForwardRule>): PortForwardRule | undefined {
    const rule = this.data.rules.find((r) => r.id === id);
    if (!rule) return undefined;
    Object.assign(rule, patch, { id: rule.id, sessionId: rule.sessionId });
    this.flush();
    return rule;
  }

  remove(id: string): void {
    this.data.rules = this.data.rules.filter((r) => r.id !== id);
    this.flush();
  }

  /** Dipanggil saat sebuah session dihapus — aturannya sudah tidak punya tempat. */
  removeForSession(sessionId: string): void {
    this.data.rules = this.data.rules.filter((r) => r.sessionId !== sessionId);
    this.flush();
  }
}

export const portForwardRules = new PortForwardStore();
