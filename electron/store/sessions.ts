import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { app, safeStorage } from 'electron';

import type { SessionConfig, Secret, ServerGroupMetadata } from '../../src/shared/types';

/**
 * Penyimpanan session berbasis satu berkas JSON.
 *
 * Tidak ada modul native di sini — hanya `node:fs`. Itu keputusan sadar:
 * modul native harus dikompilasi ulang setiap kali versi Electron atau Node
 * berubah, dan kompilasinya bergantung pada toolchain C++ di mesin
 * pengembang. Untuk data sebesar daftar server, SQLite tidak memberi
 * keuntungan yang sepadan dengan biaya itu.
 *
 * Password dan passphrase tetap dienkripsi lewat `safeStorage` (DPAPI di
 * Windows) dan disimpan sebagai base64 di dalam JSON — berkasnya sendiri
 * tidak pernah memuat kredensial dalam bentuk terbaca.
 */

interface StoredSession extends SessionConfig {
  passwordEnc?: string;
  passphraseEnc?: string;
}

interface StoreFile {
  version: 1;
  sessions: StoredSession[];
  groups?: Record<string, ServerGroupMetadata>;
}

const EMPTY: StoreFile = { version: 1, sessions: [], groups: {} };

function stripSecrets({ passwordEnc, passphraseEnc, ...config }: StoredSession): SessionConfig {
  return config;
}

export class SessionStore {
  private readonly path: string;
  private data: StoreFile;

  constructor(path = join(app.getPath('userData'), 'sessions.json')) {
    this.path = path;
    this.data = this.read();
  }

  private read(): StoreFile {
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as StoreFile;
      if (!Array.isArray(parsed.sessions)) return { ...EMPTY };
      return parsed;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return { ...EMPTY };
      // Berkas rusak atau tidak bisa di-parse. Jangan timpa diam-diam —
      // sisihkan salinannya supaya pengguna masih bisa memulihkan isinya.
      const backup = `${this.path}.corrupt-${Date.now()}`;
      try {
        renameSync(this.path, backup);
        console.error(`sessions.json tidak terbaca, disisihkan ke ${backup}`);
      } catch {
        /* kalau pemindahan pun gagal, tidak ada yang bisa diselamatkan */
      }
      return { ...EMPTY };
    }
  }

  /** Tulis lewat berkas sementara agar tidak ada tulisan setengah jadi. */
  private flush(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const temp = `${this.path}.tmp`;
    writeFileSync(temp, JSON.stringify(this.data, null, 2), { encoding: 'utf8', mode: 0o600 });
    renameSync(temp, this.path);
  }

  private encrypt(value: string | undefined): string | undefined {
    if (!value) return undefined;
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error(
        'Penyimpanan terenkripsi tidak tersedia di sistem ini. ' +
          'Gunakan autentikasi private key atau SSH agent.',
      );
    }
    return safeStorage.encryptString(value).toString('base64');
  }

  private decrypt(value: string | undefined): string | undefined {
    if (!value) return undefined;
    return safeStorage.decryptString(Buffer.from(value, 'base64'));
  }

  private find(id: string): StoredSession | undefined {
    return this.data.sessions.find((session) => session.id === id);
  }

  list(): SessionConfig[] {
    return [...this.data.sessions]
      .sort(
        (a, b) =>
          (a.group ?? '\uffff').localeCompare(b.group ?? '\uffff') ||
          a.name.localeCompare(b.name),
      )
      .map(stripSecrets);
  }

  get(id: string): SessionConfig | undefined {
    const session = this.find(id);
    return session ? stripSecrets(session) : undefined;
  }

  /** Hanya dipanggil di proses main, tepat sebelum connect. */
  getSecret(id: string): Secret {
    const session = this.find(id);
    if (!session) return {};
    return {
      password: this.decrypt(session.passwordEnc),
      passphrase: this.decrypt(session.passphraseEnc),
    };
  }

  create(config: Omit<SessionConfig, 'id' | 'createdAt'>, secret: Secret = {}): SessionConfig {
    const record: StoredSession = {
      ...config,
      id: randomUUID(),
      createdAt: Date.now(),
      passwordEnc: this.encrypt(secret.password),
      passphraseEnc: this.encrypt(secret.passphrase),
    };

    this.data.sessions.push(record);
    this.flush();
    return stripSecrets(record);
  }

  update(id: string, patch: Partial<SessionConfig>, secret?: Secret): void {
    const session = this.find(id);
    if (!session) throw new Error(`Session ${id} tidak ditemukan.`);

    Object.assign(session, patch, { id: session.id, createdAt: session.createdAt });

    if (secret) {
      // Nilai kosong berarti "biarkan yang lama", bukan "hapus" — form
      // menampilkan kolom password kosong saat mengubah server yang ada.
      if (secret.password) session.passwordEnc = this.encrypt(secret.password);
      if (secret.passphrase) session.passphraseEnc = this.encrypt(secret.passphrase);
    }

    this.flush();
  }

  touch(id: string): void {
    const session = this.find(id);
    if (!session) return;
    session.lastUsedAt = Date.now();
    this.flush();
  }

  remove(id: string): void {
    this.data.sessions = this.data.sessions.filter((session) => session.id !== id);
    this.flush();
  }

  listGroups(): Record<string, ServerGroupMetadata> {
    const result: Record<string, ServerGroupMetadata> = { ...(this.data.groups ?? {}) };
    for (const session of this.data.sessions) {
      const g = session.group?.trim();
      if (g && !result[g]) {
        result[g] = { id: g, name: g };
      }
    }
    return result;
  }

  saveGroup(id: string, metadata: Partial<ServerGroupMetadata>): void {
    const key = id.trim();
    if (!key) return;
    if (!this.data.groups) this.data.groups = {};
    const existing = this.data.groups[key] ?? { id: key, name: key };
    this.data.groups[key] = {
      ...existing,
      ...metadata,
      id: key,
    };
    this.flush();
  }

  renameGroup(oldName: string, newName: string): void {
    const trimmedOld = oldName.trim();
    const trimmedNew = newName.trim();
    if (!trimmedOld || !trimmedNew || trimmedOld === trimmedNew) return;

    const oldPrefix = `${trimmedOld}/`;
    const newPrefix = `${trimmedNew}/`;

    for (const session of this.data.sessions) {
      if (session.group === trimmedOld) {
        session.group = trimmedNew;
      } else if (session.group?.startsWith(oldPrefix)) {
        session.group = `${newPrefix}${session.group.slice(oldPrefix.length)}`;
      }
    }

    if (this.data.groups) {
      for (const [key, meta] of Object.entries({ ...this.data.groups })) {
        if (key === trimmedOld) {
          delete this.data.groups[key];
          this.data.groups[trimmedNew] = {
            ...meta,
            id: trimmedNew,
            name: meta.name === trimmedOld ? trimmedNew : meta.name,
          };
        } else if (key.startsWith(oldPrefix)) {
          const updatedKey = `${newPrefix}${key.slice(oldPrefix.length)}`;
          delete this.data.groups[key];
          this.data.groups[updatedKey] = {
            ...meta,
            id: updatedKey,
            name: meta.name === key ? updatedKey : meta.name,
          };
        }
      }
    }

    this.flush();
  }

  deleteGroup(name: string): void {
    const trimmed = name.trim();
    const prefix = `${trimmed}/`;

    for (const session of this.data.sessions) {
      if (session.group === trimmed || session.group?.startsWith(prefix)) {
        session.group = undefined;
      }
    }

    if (this.data.groups) {
      for (const key of Object.keys(this.data.groups)) {
        if (key === trimmed || key.startsWith(prefix)) {
          delete this.data.groups[key];
        }
      }
    }

    this.flush();
  }

  reorderGroups(order: string[]): void {
    if (!this.data.groups) this.data.groups = {};
    order.forEach((id, index) => {
      const key = id.trim();
      if (!key) return;
      if (!this.data.groups![key]) {
        this.data.groups![key] = { id: key, order: index };
      } else {
        this.data.groups![key].order = index;
      }
    });
    this.flush();
  }

  exportBackup(): {
    version: 1;
    exportedAt: number;
    sessions: SessionConfig[];
    groups: Record<string, ServerGroupMetadata>;
  } {
    return {
      version: 1,
      exportedAt: Date.now(),
      sessions: this.data.sessions.map((s) => stripSecrets(s)),
      groups: { ...(this.data.groups ?? {}) },
    };
  }

  importBackup(backupData: {
    version?: number;
    sessions?: Partial<SessionConfig>[];
    groups?: Record<string, ServerGroupMetadata>;
  }): { importedSessions: number; importedGroups: number } {
    if (!backupData || !Array.isArray(backupData.sessions)) {
      throw new Error('Format berkas cadangan tidak valid (sessions array tidak ditemukan).');
    }

    let importedSessions = 0;
    let importedGroups = 0;

    // Merge grup & metadata
    if (backupData.groups && typeof backupData.groups === 'object') {
      if (!this.data.groups) this.data.groups = {};
      for (const [key, meta] of Object.entries(backupData.groups)) {
        if (key && meta) {
          const current = this.data.groups[key] ?? { id: key, name: key };
          this.data.groups[key] = {
            ...current,
            id: key,
            name: meta.name || key,
            color: meta.color ?? current.color,
            icon: meta.icon ?? current.icon,
            order: typeof meta.order === 'number' ? meta.order : (current.order ?? 9999),
          };
          importedGroups++;
        }
      }
    }

    // Merge / append sesi server
    for (const raw of backupData.sessions) {
      if (!raw.host || !raw.name) continue;
      const targetId = raw.id && !this.data.sessions.some((s) => s.id === raw.id)
        ? raw.id
        : randomUUID();

      const newSession: StoredSession = {
        id: targetId,
        name: String(raw.name),
        host: String(raw.host),
        port: Number(raw.port) || 22,
        username: String(raw.username || 'root'),
        authMethod: raw.authMethod === 'privateKey' ? 'privateKey' : 'password',
        privateKeyPath: raw.privateKeyPath ? String(raw.privateKeyPath) : undefined,
        group: raw.group ? String(raw.group) : undefined,
        color: raw.color ? String(raw.color) : undefined,
        jumpHostId: raw.jumpHostId ? String(raw.jumpHostId) : undefined,
        createdAt: Number(raw.createdAt) || Date.now(),
        lastUsedAt: raw.lastUsedAt ? Number(raw.lastUsedAt) : undefined,
      };

      const existingIndex = this.data.sessions.findIndex(
        (s) =>
          s.host === newSession.host &&
          s.port === newSession.port &&
          s.username === newSession.username,
      );

      if (existingIndex >= 0) {
        this.data.sessions[existingIndex] = {
          ...this.data.sessions[existingIndex],
          name: newSession.name,
          group: newSession.group ?? this.data.sessions[existingIndex].group,
          color: newSession.color ?? this.data.sessions[existingIndex].color,
        };
      } else {
        this.data.sessions.push(newSession);
      }
      importedSessions++;
    }

    this.flush();
    return { importedSessions, importedGroups };
  }

  close(): void {
    // Tidak ada koneksi database yang perlu ditutup; setiap perubahan
    // sudah ditulis ke disk saat terjadi.
  }
}
