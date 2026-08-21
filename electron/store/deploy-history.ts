import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { app } from 'electron';

import type { DeployHistoryEntry } from '../../src/shared/types';

/**
 * Riwayat deploy/rollback per project — dipakai untuk daftar riwayat dan
 * sebagai sumber target rollback (commitHash-nya). Pola sama dengan
 * ProjectStore: satu berkas JSON, ditulis lewat berkas sementara. Dibatasi
 * MAX_PER_PROJECT entri terbaru per project supaya berkasnya tidak tumbuh
 * tanpa batas untuk project yang deploy terus-menerus.
 */

const MAX_PER_PROJECT = 30;

interface StoreFile {
  version: 1;
  entries: DeployHistoryEntry[];
}

const EMPTY: StoreFile = { version: 1, entries: [] };

export class DeployHistoryStore {
  private readonly path: string;
  private data: StoreFile;

  constructor(path = join(app.getPath('userData'), 'deploy-history.json')) {
    this.path = path;
    this.data = this.read();
  }

  private read(): StoreFile {
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as StoreFile;
      if (!Array.isArray(parsed.entries)) return { ...EMPTY };
      return parsed;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return { ...EMPTY };
      const backup = `${this.path}.corrupt-${Date.now()}`;
      try {
        renameSync(this.path, backup);
        console.error(`deploy-history.json tidak terbaca, disisihkan ke ${backup}`);
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

  list(projectId: string): DeployHistoryEntry[] {
    return this.data.entries
      .filter((e) => e.projectId === projectId)
      .sort((a, b) => b.startedAt - a.startedAt);
  }

  get(id: string): DeployHistoryEntry | undefined {
    return this.data.entries.find((e) => e.id === id);
  }

  start(
    input: Pick<
      DeployHistoryEntry,
      'sessionId' | 'projectId' | 'projectName' | 'templateId' | 'templateName' | 'isRollback' | 'rollbackOfEntryId'
    >,
  ): DeployHistoryEntry {
    const entry: DeployHistoryEntry = {
      id: randomUUID(),
      startedAt: Date.now(),
      ...input,
    };
    this.data.entries.push(entry);

    // Buang entri terlama untuk project ini kalau sudah melebihi batas.
    const forProject = this.data.entries
      .filter((e) => e.projectId === entry.projectId)
      .sort((a, b) => a.startedAt - b.startedAt);
    if (forProject.length > MAX_PER_PROJECT) {
      const toDrop = new Set(forProject.slice(0, forProject.length - MAX_PER_PROJECT).map((e) => e.id));
      this.data.entries = this.data.entries.filter((e) => !toDrop.has(e.id));
    }

    this.flush();
    return entry;
  }

  finish(id: string, patch: Pick<DeployHistoryEntry, 'success' | 'message' | 'commitHash'>): void {
    const entry = this.data.entries.find((e) => e.id === id);
    if (!entry) return;
    Object.assign(entry, patch, { finishedAt: Date.now() });
    this.flush();
  }

  /** Dipanggil saat sebuah session dihapus — riwayatnya sudah tidak punya tempat. */
  removeForSession(sessionId: string): void {
    this.data.entries = this.data.entries.filter((e) => e.sessionId !== sessionId);
    this.flush();
  }

  /** Dipanggil saat sebuah project dihapus. */
  removeForProject(projectId: string): void {
    this.data.entries = this.data.entries.filter((e) => e.projectId !== projectId);
    this.flush();
  }
}

export const deployHistory = new DeployHistoryStore();
