import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { app } from 'electron';

/**
 * Kunci aplikasi opsional — PIN pendek yang harus dimasukkan setiap kali
 * ASProOps dibuka, sebelum daftar server dan kredensial tersimpan bisa
 * diakses. Ini BUKAN pengganti enkripsi `safeStorage` di SessionStore —
 * itu tetap yang melindungi isi berkas di disk. Ini cuma penghalang di
 * lapisan UI+IPC supaya orang yang kebetulan duduk di depan mesin yang
 * sudah login tidak langsung bisa connect pakai password yang tersimpan.
 */

interface LockFile {
  salt: string;
  hash: string;
  /** Menit tanpa aktivitas sebelum otomatis dikunci lagi. 0 = mati. */
  idleMinutes?: number;
}

export interface LockStatus {
  enabled: boolean;
  locked: boolean;
  idleMinutes: number;
}

const DEFAULT_IDLE_MINUTES = 10;

export interface VerifyResult {
  ok: boolean;
  retryAfterMs?: number;
}

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 30_000;
const SCRYPT_KEYLEN = 64;

export class AppLock {
  private readonly path: string;
  private unlocked = false;
  private failedAttempts = 0;
  private lockedUntil = 0;

  constructor(path = join(app.getPath('userData'), 'applock.json')) {
    this.path = path;
  }

  private readFile(): LockFile | null {
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as LockFile;
      if (!parsed.salt || !parsed.hash) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private hash(pin: string, salt: Buffer): Buffer {
    return scryptSync(pin, salt, SCRYPT_KEYLEN);
  }

  isEnabled(): boolean {
    return this.readFile() !== null;
  }

  /** Terkunci hanya kalau PIN sudah diatur DAN proses ini belum pernah verify sukses. */
  isLocked(): boolean {
    return this.isEnabled() && !this.unlocked;
  }

  status(): LockStatus {
    return {
      enabled: this.isEnabled(),
      locked: this.isLocked(),
      idleMinutes: this.readFile()?.idleMinutes ?? DEFAULT_IDLE_MINUTES,
    };
  }

  /** Set PIN baru. Kalau lock sedang aktif, verifikasi PIN lama dulu sebelum memanggil ini. */
  setPin(pin: string): void {
    // Pertahankan idleMinutes yang sudah diatur sebelumnya — setPin juga
    // dipanggil saat GANTI PIN, bukan cuma setup pertama kali.
    const idleMinutes = this.readFile()?.idleMinutes;
    const salt = randomBytes(16);
    const hash = this.hash(pin, salt);
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(
      this.path,
      JSON.stringify({
        salt: salt.toString('hex'),
        hash: hash.toString('hex'),
        ...(idleMinutes !== undefined ? { idleMinutes } : {}),
      }),
      { mode: 0o600 },
    );
    this.unlocked = true;
    this.failedAttempts = 0;
    this.lockedUntil = 0;
  }

  /** Dipanggil dari renderer setelah idle timeout tercapai. */
  relock(): void {
    if (this.isEnabled()) this.unlocked = false;
  }

  setIdleMinutes(minutes: number): void {
    const stored = this.readFile();
    if (!stored) return; // tidak ada gunanya tanpa PIN yang diatur
    const clamped = Math.max(0, Math.min(180, Math.round(minutes)));
    writeFileSync(this.path, JSON.stringify({ ...stored, idleMinutes: clamped }), {
      mode: 0o600,
    });
  }

  disable(): void {
    try {
      unlinkSync(this.path);
    } catch {
      /* sudah tidak ada berkasnya, tidak masalah */
    }
    this.unlocked = true;
    this.failedAttempts = 0;
    this.lockedUntil = 0;
  }

  verify(pin: string): VerifyResult {
    const now = Date.now();
    if (now < this.lockedUntil) {
      return { ok: false, retryAfterMs: this.lockedUntil - now };
    }

    const stored = this.readFile();
    if (!stored) {
      // Belum pernah diatur — anggap terbuka (dipanggil main.ts sebelum
      // status diperiksa renderer tidak akan pernah sampai sini, tapi
      // aman kalau dipanggil langsung).
      this.unlocked = true;
      return { ok: true };
    }

    const salt = Buffer.from(stored.salt, 'hex');
    const expected = Buffer.from(stored.hash, 'hex');
    const actual = this.hash(pin, salt);
    const ok = actual.length === expected.length && timingSafeEqual(actual, expected);

    if (ok) {
      this.unlocked = true;
      this.failedAttempts = 0;
      this.lockedUntil = 0;
      return { ok: true };
    }

    this.failedAttempts += 1;
    if (this.failedAttempts >= MAX_ATTEMPTS) {
      this.lockedUntil = now + LOCKOUT_MS;
      this.failedAttempts = 0;
    }
    return { ok: false };
  }
}
