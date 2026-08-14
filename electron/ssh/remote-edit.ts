import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shell } from 'electron';

import type { SessionChannels } from './connection-manager';

/**
 * Edit berkas remote lewat editor lokal.
 *
 * Alurnya: unduh ke folder sementara, buka dengan aplikasi bawaan sistem,
 * lalu pantau berkasnya dan unggah ulang setiap kali berubah.
 *
 * Perubahan dideteksi dengan memeriksa mtime dan ukuran secara berkala,
 * bukan `fs.watch`. Alasannya: banyak editor — VS Code, Notepad++, vim —
 * menyimpan dengan menulis berkas baru lalu me-rename-nya menimpa yang
 * lama. `fs.watch` memantau inode, jadi setelah rename pertama ia memantau
 * berkas yang sudah tidak ada dan penyimpanan berikutnya tidak terdeteksi.
 */

export type EditState = 'opening' | 'watching' | 'uploading' | 'saved' | 'error';

export interface EditStatus {
  editId: string;
  sessionId: string;
  remotePath: string;
  filename: string;
  state: EditState;
  message?: string;
  savedAt?: number;
}

interface ActiveEdit {
  editId: string;
  sessionId: string;
  remotePath: string;
  filename: string;
  localDir: string;
  localPath: string;
  timer: NodeJS.Timeout;
  lastMtimeMs: number;
  lastSize: number;
  uploading: boolean;
}

/** Berkas besar hampir pasti bukan berkas konfigurasi — jangan buka di editor. */
const MAX_EDIT_BYTES = 8 * 1024 * 1024;
const POLL_INTERVAL_MS = 1000;

export class RemoteEditManager {
  private readonly edits = new Map<string, ActiveEdit>();

  constructor(private readonly onStatus: (status: EditStatus) => void) {}

  private emit(edit: ActiveEdit, state: EditState, extra?: Partial<EditStatus>): void {
    this.onStatus({
      editId: edit.editId,
      sessionId: edit.sessionId,
      remotePath: edit.remotePath,
      filename: edit.filename,
      state,
      ...extra,
    });
  }

  async open(
    sessionId: string,
    connection: SessionChannels,
    remotePath: string,
    sizeBytes: number,
  ): Promise<string> {
    if (sizeBytes > MAX_EDIT_BYTES) {
      throw new Error(
        `Berkas ini ${Math.round(sizeBytes / 1024 / 1024)} MB — terlalu besar untuk dibuka ` +
          'di editor. Gunakan unduh biasa.',
      );
    }

    // Sudah dibuka sebelumnya? Fokuskan yang ada, jangan buat salinan kedua
    // yang bisa saling menimpa saat disimpan.
    for (const existing of this.edits.values()) {
      if (existing.sessionId === sessionId && existing.remotePath === remotePath) {
        await shell.openPath(existing.localPath);
        return existing.editId;
      }
    }

    const filename = remotePath.split('/').pop() ?? 'berkas';
    const localDir = await mkdtemp(join(tmpdir(), 'ssh-client-edit-'));
    const localPath = join(localDir, filename);

    const sftp = await connection.getSftp();
    await new Promise<void>((resolve, reject) => {
      sftp.fastGet(remotePath, localPath, (err) => (err ? reject(err) : resolve()));
    });

    const initial = await stat(localPath);
    const edit: ActiveEdit = {
      editId: randomUUID(),
      sessionId,
      remotePath,
      filename,
      localDir,
      localPath,
      lastMtimeMs: initial.mtimeMs,
      lastSize: initial.size,
      uploading: false,
      timer: setInterval(() => void this.check(edit, connection), POLL_INTERVAL_MS),
    };
    this.edits.set(edit.editId, edit);

    this.emit(edit, 'opening');

    // openPath mengembalikan string kosong kalau berhasil, atau pesan error
    // kalau ekstensi berkas tidak punya aplikasi terkait di Windows.
    const failure = await shell.openPath(localPath);
    if (failure) {
      this.emit(edit, 'error', {
        message:
          `Windows tidak punya aplikasi untuk membuka ${filename}. ` +
          `Salinannya ada di ${localPath} — buka manual, penyimpanan tetap terdeteksi.`,
      });
    } else {
      this.emit(edit, 'watching');
    }

    return edit.editId;
  }

  private async check(edit: ActiveEdit, connection: SessionChannels): Promise<void> {
    if (edit.uploading) return;

    let current: Awaited<ReturnType<typeof stat>>;
    try {
      current = await stat(edit.localPath);
    } catch {
      // Berkas sedang dalam proses rename oleh editor; coba lagi siklus depan.
      return;
    }

    if (current.mtimeMs === edit.lastMtimeMs && current.size === edit.lastSize) return;

    edit.lastMtimeMs = current.mtimeMs;
    edit.lastSize = current.size;
    edit.uploading = true;
    this.emit(edit, 'uploading');

    try {
      const sftp = await connection.getSftp();
      await new Promise<void>((resolve, reject) => {
        sftp.fastPut(edit.localPath, edit.remotePath, (err) => (err ? reject(err) : resolve()));
      });
      this.emit(edit, 'saved', { savedAt: Date.now() });
    } catch (err) {
      this.emit(edit, 'error', { message: (err as Error).message });
    } finally {
      edit.uploading = false;
    }
  }

  list(sessionId?: string): EditStatus[] {
    return [...this.edits.values()]
      .filter((edit) => !sessionId || edit.sessionId === sessionId)
      .map((edit) => ({
        editId: edit.editId,
        sessionId: edit.sessionId,
        remotePath: edit.remotePath,
        filename: edit.filename,
        state: edit.uploading ? ('uploading' as const) : ('watching' as const),
      }));
  }

  async close(editId: string): Promise<void> {
    const edit = this.edits.get(editId);
    if (!edit) return;
    clearInterval(edit.timer);
    this.edits.delete(editId);
    // Salinan lokal dibuang — kalau tidak, folder temp menumpuk berkas
    // konfigurasi server yang isinya bisa sensitif.
    await rm(edit.localDir, { recursive: true, force: true });
  }

  async closeSession(sessionId: string): Promise<void> {
    for (const edit of [...this.edits.values()]) {
      if (edit.sessionId === sessionId) await this.close(edit.editId);
    }
  }

  closeAll(): void {
    for (const edit of this.edits.values()) clearInterval(edit.timer);
    this.edits.clear();
  }
}
