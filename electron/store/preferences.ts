import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { app } from 'electron';

/**
 * Preferensi koneksi SSH — bukan per-sesi, berlaku untuk semua server.
 * Disimpan terpisah dari sessions.json karena ini bukan kredensial dan
 * boleh dibaca/ditulis tanpa lewat SessionStore.
 */

export interface SshPreferences {
  /** Berapa lama menunggu server merespons sebelum percobaan connect gagal. */
  timeoutMs: number;
  /** Seberapa sering mengirim ping supaya koneksi diam tidak dianggap putus oleh NAT/firewall. */
  keepaliveIntervalMs: number;
  /** Berapa kali ping boleh tidak terjawab sebelum ssh2 menganggap koneksi mati. */
  keepaliveCountMax: number;
  /** Coba sambung ulang otomatis kalau koneksi terputus tanpa diminta pengguna. */
  autoReconnect: boolean;
}

export const DEFAULT_SSH_PREFERENCES: SshPreferences = {
  timeoutMs: 20_000,
  keepaliveIntervalMs: 15_000,
  keepaliveCountMax: 3,
  autoReconnect: true,
};

const MIN_TIMEOUT_MS = 3_000;
const MAX_TIMEOUT_MS = 120_000;
const MIN_KEEPALIVE_MS = 5_000;
const MAX_KEEPALIVE_MS = 120_000;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export class PreferencesStore {
  private readonly path: string;
  private data: SshPreferences;

  constructor(path = join(app.getPath('userData'), 'preferences.json')) {
    this.path = path;
    this.data = this.read();
  }

  private read(): SshPreferences {
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<SshPreferences>;
      return { ...DEFAULT_SSH_PREFERENCES, ...parsed };
    } catch {
      return { ...DEFAULT_SSH_PREFERENCES };
    }
  }

  private flush(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.data, null, 2), { mode: 0o600 });
  }

  get(): SshPreferences {
    return { ...this.data };
  }

  update(patch: Partial<SshPreferences>): SshPreferences {
    this.data = {
      timeoutMs: clamp(patch.timeoutMs ?? this.data.timeoutMs, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS),
      keepaliveIntervalMs: clamp(
        patch.keepaliveIntervalMs ?? this.data.keepaliveIntervalMs,
        MIN_KEEPALIVE_MS,
        MAX_KEEPALIVE_MS,
      ),
      keepaliveCountMax: Math.round(
        clamp(patch.keepaliveCountMax ?? this.data.keepaliveCountMax, 1, 10),
      ),
      autoReconnect: patch.autoReconnect ?? this.data.autoReconnect,
    };
    this.flush();
    return this.get();
  }

  reset(): SshPreferences {
    this.data = { ...DEFAULT_SSH_PREFERENCES };
    this.flush();
    return this.get();
  }
}

/**
 * Satu instance untuk seluruh proses main. connection-manager.ts membaca ini
 * langsung di setiap percobaan connect, jadi perubahan dari Settings
 * berlaku seketika tanpa perlu restart aplikasi.
 */
export const preferences = new PreferencesStore();

/**
 * Preferensi SFTP: folder unduhan default dan kebijakan konflik nama.
 *
 * 'ask' untuk unduhan berarti tetap memakai dialog "Simpan Sebagai" native
 * (yang sudah punya konfirmasi timpa bawaan OS) — folder default cuma
 * dipakai sebagai lokasi awal dialog itu. Kebijakan lain (overwrite/skip/
 * rename) melewati dialog sama sekali untuk unduhan berulang yang cepat.
 * Untuk unggahan, 'ask' berarti FileBrowser menampilkan dialog konfirmasi
 * sendiri di renderer karena tidak ada dialog native untuk berkas remote.
 */

export type ConflictPolicy = 'ask' | 'overwrite' | 'skip' | 'rename';

export interface SftpPreferences {
  /** Kosong berarti selalu tanya lewat dialog "Simpan Sebagai" (perilaku lama). */
  downloadFolder: string;
  uploadConflict: ConflictPolicy;
  downloadConflict: ConflictPolicy;
}

export const DEFAULT_SFTP_PREFERENCES: SftpPreferences = {
  downloadFolder: '',
  uploadConflict: 'ask',
  downloadConflict: 'ask',
};

const CONFLICT_POLICIES: ConflictPolicy[] = ['ask', 'overwrite', 'skip', 'rename'];

function isConflictPolicy(value: unknown): value is ConflictPolicy {
  return typeof value === 'string' && CONFLICT_POLICIES.includes(value as ConflictPolicy);
}

export class SftpPreferencesStore {
  private readonly path: string;
  private data: SftpPreferences;

  constructor(path = join(app.getPath('userData'), 'sftp-preferences.json')) {
    this.path = path;
    this.data = this.read();
  }

  private read(): SftpPreferences {
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<SftpPreferences>;
      return { ...DEFAULT_SFTP_PREFERENCES, ...parsed };
    } catch {
      return { ...DEFAULT_SFTP_PREFERENCES };
    }
  }

  private flush(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.data, null, 2), { mode: 0o600 });
  }

  get(): SftpPreferences {
    return { ...this.data };
  }

  update(patch: Partial<SftpPreferences>): SftpPreferences {
    this.data = {
      downloadFolder:
        typeof patch.downloadFolder === 'string' ? patch.downloadFolder : this.data.downloadFolder,
      uploadConflict: isConflictPolicy(patch.uploadConflict)
        ? patch.uploadConflict
        : this.data.uploadConflict,
      downloadConflict: isConflictPolicy(patch.downloadConflict)
        ? patch.downloadConflict
        : this.data.downloadConflict,
    };
    this.flush();
    return this.get();
  }

  reset(): SftpPreferences {
    this.data = { ...DEFAULT_SFTP_PREFERENCES };
    this.flush();
    return this.get();
  }
}

export const sftpPreferences = new SftpPreferencesStore();
