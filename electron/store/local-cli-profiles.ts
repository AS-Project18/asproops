import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app } from 'electron';

import type {
  LocalCliAvailability,
  LocalCliCreateInput,
  LocalCliProfile,
  LocalCliUpdatePatch,
} from '../../src/shared/types';

interface StoreFile {
  version: 1;
  profiles: LocalCliProfile[];
}

const BUILTIN_IDS = new Set(['omp', 'codex', 'claude']);

function builtinProfiles(now = Date.now()): LocalCliProfile[] {
  return [
    {
      id: 'omp',
      name: 'OMP',
      command: 'omp',
      args: [],
      source: 'builtin',
      enabled: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'codex',
      name: 'Codex',
      command: 'codex',
      args: [],
      source: 'builtin',
      enabled: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'claude',
      name: 'Claude',
      command: 'claude',
      args: [],
      source: 'builtin',
      enabled: true,
      createdAt: now,
      updatedAt: now,
    },
  ];
}

function clone(profile: LocalCliProfile): LocalCliProfile {
  return { ...profile, args: [...profile.args] };
}

export class LocalCliProfileStore {
  private readonly path: string;
  private data: StoreFile;

  constructor(path = join(app.getPath('userData'), 'local-cli-profiles.json')) {
    this.path = path;
    this.data = this.read();
  }

  private read(): StoreFile {
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as StoreFile;
      if (parsed.version !== 1 || !Array.isArray(parsed.profiles)) {
        throw new Error('Format local-cli-profiles.json tidak dikenali.');
      }

      const byId = new Map(parsed.profiles.map((profile) => [profile.id, profile]));
      for (const builtin of builtinProfiles()) {
        if (!byId.has(builtin.id)) parsed.profiles.push(builtin);
      }
      return parsed;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return { version: 1, profiles: builtinProfiles() };
      }

      const backup = `${this.path}.corrupt-${Date.now()}`;
      try {
        renameSync(this.path, backup);
        console.error(`local-cli-profiles.json tidak terbaca, disisihkan ke ${backup}`);
      } catch {
        // Jangan menimpa file rusak kalau quarantine juga gagal.
      }
      return { version: 1, profiles: builtinProfiles() };
    }
  }

  private flush(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const temp = `${this.path}.tmp`;
    writeFileSync(temp, JSON.stringify(this.data, null, 2), { encoding: 'utf8', mode: 0o600 });
    renameSync(temp, this.path);
  }

  private validateName(value: string): string {
    const name = value.trim();
    if (!name) throw new Error('Nama CLI wajib diisi.');
    if (name.length > 80) throw new Error('Nama CLI terlalu panjang.');
    return name;
  }

  private validateCommand(value: string): string {
    const command = value.trim();
    if (!command) throw new Error('Command CLI wajib diisi.');
    if (command.length > 120) throw new Error('Command CLI terlalu panjang.');

    // CLI Registry hanya menerima nama executable/command tunggal. Shell
    // expression sengaja ditolak; command bebas adalah domain Quick Commands.
    if (!/^[A-Za-z0-9._+-]+$/.test(command)) {
      throw new Error(
        'Command CLI harus nama executable tunggal tanpa spasi/path/operator shell, mis. codex, claude, agy, atau gemini.',
      );
    }
    return command;
  }

  private validateArgs(values: string[] | undefined): string[] {
    if (!values) return [];
    if (!Array.isArray(values) || values.length > 24) {
      throw new Error('Arguments CLI tidak valid.');
    }

    return values.map((raw) => {
      const value = raw.trim();
      if (!value) throw new Error('Argument CLI tidak boleh kosong.');
      if (value.length > 160 || !/^[A-Za-z0-9._/:=@,+-]+$/.test(value)) {
        throw new Error(
          `Argument CLI "${raw}" tidak aman. Gunakan token sederhana tanpa spasi/operator shell.`,
        );
      }
      return value;
    });
  }

  list(): LocalCliProfile[] {
    return [...this.data.profiles]
      .sort((a, b) => {
        if (a.source !== b.source) return a.source === 'builtin' ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .map(clone);
  }

  listWithAvailability(isAvailable: (command: string) => boolean): LocalCliAvailability[] {
    return this.list().map((profile) => {
      const available = profile.enabled && isAvailable(profile.command);
      return {
        ...profile,
        available,
        status: !profile.enabled ? 'disabled' : available ? 'available' : 'not_found',
        versionStatus: 'skipped',
      };
    });
  }

  get(id: string): LocalCliProfile | undefined {
    const profile = this.data.profiles.find((item) => item.id === id);
    return profile ? clone(profile) : undefined;
  }

  requireEnabled(id: string): LocalCliProfile {
    const profile = this.data.profiles.find((item) => item.id === id);
    if (!profile) throw new Error('CLI profile tidak ditemukan.');
    if (!profile.enabled) throw new Error(`CLI "${profile.name}" sedang dinonaktifkan.`);

    // Validasi lagi saat launch sebagai defense-in-depth terhadap file store
    // yang mungkin diedit manual di luar aplikasi.
    this.validateCommand(profile.command);
    this.validateArgs(profile.args);
    return clone(profile);
  }

  create(input: LocalCliCreateInput): LocalCliProfile {
    const now = Date.now();
    const profile: LocalCliProfile = {
      id: randomUUID(),
      name: this.validateName(input.name),
      command: this.validateCommand(input.command),
      args: this.validateArgs(input.args),
      source: 'custom',
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    };

    this.data.profiles.push(profile);
    this.flush();
    return clone(profile);
  }

  update(id: string, patch: LocalCliUpdatePatch): LocalCliProfile | undefined {
    const profile = this.data.profiles.find((item) => item.id === id);
    if (!profile) return undefined;

    if (patch.name !== undefined) profile.name = this.validateName(patch.name);
    if (patch.command !== undefined) profile.command = this.validateCommand(patch.command);
    if (patch.args !== undefined) profile.args = this.validateArgs(patch.args);
    if (patch.enabled !== undefined) profile.enabled = Boolean(patch.enabled);

    profile.updatedAt = Date.now();
    this.flush();
    return clone(profile);
  }

  remove(id: string): void {
    const profile = this.data.profiles.find((item) => item.id === id);
    if (!profile) return;
    if (profile.source === 'builtin' || BUILTIN_IDS.has(id)) {
      throw new Error('CLI bawaan tidak dapat dihapus. Nonaktifkan jika tidak ingin digunakan.');
    }

    this.data.profiles = this.data.profiles.filter((item) => item.id !== id);
    this.flush();
  }
}

export const localCliProfiles = new LocalCliProfileStore();
