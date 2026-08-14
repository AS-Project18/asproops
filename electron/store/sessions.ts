import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { app, safeStorage } from 'electron';

import type { SessionConfig, Secret } from '../../src/shared/types';

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
}

const EMPTY: StoreFile = { version: 1, sessions: [] };

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

  close(): void {
    // Tidak ada koneksi database yang perlu ditutup; setiap perubahan
    // sudah ditulis ke disk saat terjadi.
  }
}
