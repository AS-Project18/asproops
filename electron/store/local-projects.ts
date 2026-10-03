import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { app } from 'electron';

import type {
  LocalProjectCreateInput,
  LocalProjectProfile,
  LocalProjectSummary,
  LocalProjectUpdatePatch,
} from '../../src/shared/types';

interface StoreFile {
  version: 3;
  projects: LocalProjectProfile[];
}

type LegacyProject = Omit<LocalProjectProfile, 'preferredCliProfileId' | 'favorite'> & {
  preferredCli?: string;
};

interface LegacyStoreFile {
  version: 1;
  projects: LegacyProject[];
}

interface V2StoreFile {
  version: 2;
  projects: Array<Omit<LocalProjectProfile, 'favorite'>>;
}

const EMPTY: StoreFile = { version: 3, projects: [] };

function normalizePathForCompare(path: string): string {
  const normalized = resolve(path).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function pathIsDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export class LocalProjectStore {
  private readonly path: string;
  private data: StoreFile;

  constructor(path = join(app.getPath('userData'), 'local-projects.json')) {
    this.path = path;
    this.data = this.read();
  }

  private read(): StoreFile {
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as
        | StoreFile
        | V2StoreFile
        | LegacyStoreFile;

      if (parsed.version === 3 && Array.isArray(parsed.projects)) {
        return parsed;
      }

      if (parsed.version === 2 && Array.isArray(parsed.projects)) {
        return {
          version: 3,
          projects: parsed.projects.map((project) => ({
            ...project,
            favorite: false,
          })),
        };
      }

      if (parsed.version === 1 && Array.isArray(parsed.projects)) {
        return {
          version: 3,
          projects: parsed.projects.map(({ preferredCli, ...project }) => ({
            ...project,
            preferredCliProfileId: preferredCli || undefined,
            favorite: false,
          })),
        };
      }

      throw new Error('Format local-projects.json tidak dikenali.');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return { ...EMPTY };

      const backup = `${this.path}.corrupt-${Date.now()}`;
      try {
        renameSync(this.path, backup);
        console.error(`local-projects.json tidak terbaca, disisihkan ke ${backup}`);
      } catch {
        // Kalau pemindahan juga gagal, mulai dari state kosong tanpa menimpa
        // berkas rusak secara diam-diam.
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

  private validateName(name: string): string {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Nama project wajib diisi.');
    if (trimmed.length > 120) throw new Error('Nama project terlalu panjang.');
    return trimmed;
  }

  private validateDirectory(path: string): string {
    const trimmed = path.trim();
    if (!isAbsolute(trimmed)) throw new Error('Path project harus berupa path absolut.');
    const normalized = resolve(trimmed);
    if (!pathIsDirectory(normalized)) {
      throw new Error(`Folder project tidak ditemukan atau bukan directory: ${trimmed}`);
    }
    return normalized;
  }

  private ensureUniquePath(path: string, exceptId?: string): void {
    const candidate = normalizePathForCompare(path);
    const duplicate = this.data.projects.find(
      (project) =>
        project.id !== exceptId && normalizePathForCompare(project.path) === candidate,
    );
    if (duplicate) {
      throw new Error(`Folder ini sudah disimpan sebagai project "${duplicate.name}".`);
    }
  }

  list(): LocalProjectProfile[] {
    return [...this.data.projects]
      .sort((a, b) => {
        const favoriteDelta = Number(Boolean(b.favorite)) - Number(Boolean(a.favorite));
        if (favoriteDelta !== 0) return favoriteDelta;

        const recentDelta = (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0);
        if (recentDelta !== 0) return recentDelta;

        return a.name.localeCompare(b.name);
      })
      .map((project) => ({ ...project }));
  }

  listWithStatus(): LocalProjectSummary[] {
    return this.list().map((project) => ({
      ...project,
      pathExists: pathIsDirectory(project.path),
    }));
  }

  get(id: string): LocalProjectProfile | undefined {
    const project = this.data.projects.find((item) => item.id === id);
    return project ? { ...project } : undefined;
  }

  requireAvailable(id: string): LocalProjectProfile {
    const project = this.data.projects.find((item) => item.id === id);
    if (!project) throw new Error('Local project tidak ditemukan.');
    this.validateDirectory(project.path);
    return { ...project };
  }

  create(input: LocalProjectCreateInput): LocalProjectProfile {
    const now = Date.now();
    const name = this.validateName(input.name);
    const path = this.validateDirectory(input.path);
    this.ensureUniquePath(path);

    const project: LocalProjectProfile = {
      id: randomUUID(),
      name,
      path,
      defaultTerminalProfileId: input.defaultTerminalProfileId || undefined,
      preferredCliProfileId: input.preferredCliProfileId || undefined,
      favorite: false,
      createdAt: now,
      updatedAt: now,
    };

    this.data.projects.push(project);
    this.flush();
    return { ...project };
  }

  update(id: string, patch: LocalProjectUpdatePatch): LocalProjectProfile | undefined {
    const project = this.data.projects.find((item) => item.id === id);
    if (!project) return undefined;

    if (patch.name !== undefined) project.name = this.validateName(patch.name);

    if (patch.path !== undefined) {
      const incomingComparable = normalizePathForCompare(patch.path);
      const currentComparable = normalizePathForCompare(project.path);

      if (incomingComparable !== currentComparable) {
        const nextPath = this.validateDirectory(patch.path);
        this.ensureUniquePath(nextPath, id);
        project.path = nextPath;
      }
    }

    if (patch.defaultTerminalProfileId !== undefined) {
      project.defaultTerminalProfileId = patch.defaultTerminalProfileId || undefined;
    }
    if (patch.preferredCliProfileId !== undefined) {
      project.preferredCliProfileId = patch.preferredCliProfileId || undefined;
    }
    if (patch.favorite !== undefined) {
      project.favorite = Boolean(patch.favorite);
    }

    project.updatedAt = Date.now();
    this.flush();
    return { ...project };
  }

  remove(id: string): void {
    const next = this.data.projects.filter((project) => project.id !== id);
    if (next.length === this.data.projects.length) return;
    this.data.projects = next;
    this.flush();
  }

  touch(id: string): void {
    const project = this.data.projects.find((item) => item.id === id);
    if (!project) return;
    project.lastOpenedAt = Date.now();
    project.updatedAt = Date.now();
    this.flush();
  }

  clearPreferredCliProfile(cliProfileId: string): void {
    let changed = false;
    for (const project of this.data.projects) {
      if (project.preferredCliProfileId !== cliProfileId) continue;
      project.preferredCliProfileId = undefined;
      project.updatedAt = Date.now();
      changed = true;
    }
    if (changed) this.flush();
  }
}

export const localProjects = new LocalProjectStore();
