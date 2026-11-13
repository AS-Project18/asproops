import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { app } from 'electron';

import type {
  CommandSnippet,
  CommandSnippetCreateInput,
  CommandSnippetUpdatePatch,
} from '../../src/shared/types';

interface StoreFile {
  version: 1;
  snippets: CommandSnippet[];
}

const DEFAULT_SNIPPETS: CommandSnippet[] = [
  // --- Universal (Cross-Platform) ---
  {
    id: 'default-docker-ps',
    name: 'Docker PS Table',
    command: 'docker ps --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}"',
    category: 'Docker',
    platform: 'all',
    description: 'Tampilkan tabel status kontainer docker aktif dengan nama dan port.',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
  {
    id: 'default-docker-compose-ps',
    name: 'Docker Compose PS',
    command: 'docker compose ps',
    category: 'Docker',
    platform: 'all',
    description: 'Cek status semua service dalam docker compose file saat ini.',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
  {
    id: 'default-docker-logs',
    name: 'Docker Logs Follow',
    command: 'docker compose logs -f --tail=100 {{service}}',
    category: 'Docker',
    platform: 'all',
    description: 'Stream 100 baris log terakhir dari service tertentu secara live.',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
  {
    id: 'default-docker-restart',
    name: 'Docker Restart Service',
    command: 'docker compose restart {{service}}',
    category: 'Docker',
    platform: 'all',
    description: 'Muat ulang service tertentu di docker compose.',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
  {
    id: 'default-docker-df',
    name: 'Docker Disk Usage',
    command: 'docker system df',
    category: 'Docker',
    platform: 'all',
    description: 'Cek konsumsi penyimpanan oleh images, containers, dan volumes.',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
  {
    id: 'default-git-status',
    name: 'Git Status',
    command: 'git status',
    category: 'Git',
    platform: 'all',
    description: 'Cek status cabang dan file yang dimodifikasi.',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
  {
    id: 'default-git-pull',
    name: 'Git Pull',
    command: 'git pull',
    category: 'Git',
    platform: 'all',
    description: 'Ambil dan gabungkan commit terbaru dari remote repository.',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },

  // --- Linux & WSL (Remote SSH / WSL) ---
  {
    id: 'default-systemd-status',
    name: 'Systemd Status',
    command: 'systemctl status {{service}}',
    category: 'Systemd',
    platform: 'linux',
    description: 'Cek status runtime dan error terakhir service systemd.',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
  {
    id: 'default-systemd-restart',
    name: 'Systemd Restart',
    command: 'sudo systemctl restart {{service}}',
    category: 'Systemd',
    platform: 'linux',
    description: 'Restart daemon/service sistem operasi.',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
  {
    id: 'default-journalctl',
    name: 'Journalctl Follow',
    command: 'journalctl -u {{service}} -f -n 100',
    category: 'Systemd',
    platform: 'linux',
    description: 'Stream log sistem untuk service tertentu.',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
  {
    id: 'default-net-listening',
    name: 'Listening Ports',
    command: 'ss -tulpn',
    category: 'Network',
    platform: 'linux',
    description: 'Daftar semua port TCP/UDP yang sedang listening beserta prosesnya.',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
  {
    id: 'default-disk-usage',
    name: 'Disk Free Space',
    command: 'df -h',
    category: 'System',
    platform: 'linux',
    description: 'Tampilkan ruang disk yang tersedia pada setiap mount point.',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
  {
    id: 'default-memory-usage',
    name: 'Memory Free',
    command: 'free -m',
    category: 'System',
    platform: 'linux',
    description: 'Tampilkan pemakaian RAM dan Swap dalam Megabyte.',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },

  // --- Windows (PowerShell / CMD) ---
  {
    id: 'default-win-service-status',
    name: 'Get Service',
    command: 'Get-Service {{service}}',
    category: 'Windows',
    platform: 'windows',
    description: 'Cek status service di Windows via PowerShell.',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
  {
    id: 'default-win-service-restart',
    name: 'Restart Service',
    command: 'Restart-Service {{service}} -Force',
    category: 'Windows',
    platform: 'windows',
    description: 'Muat ulang service di sistem Windows.',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
  {
    id: 'default-win-test-port',
    name: 'Test Port TCP',
    command: 'Test-NetConnection -ComputerName {{host}} -Port {{port}}',
    category: 'Network',
    platform: 'windows',
    description: 'Uji konektivitas TCP ke host dan port tertentu.',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
  {
    id: 'default-win-top-cpu',
    name: 'Top CPU Processes',
    command: 'Get-Process | Sort-Object CPU -Descending | Select-Object -First 10',
    category: 'Windows',
    platform: 'windows',
    description: 'Tampilkan 10 proses yang paling banyak memakai CPU di Windows.',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
  {
    id: 'default-win-ipconfig',
    name: 'IP Config All',
    command: 'ipconfig /all',
    category: 'Network',
    platform: 'windows',
    description: 'Informasi lengkap adapter jaringan, IP, DNS, dan gateway di Windows.',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
  {
    id: 'default-win-volume',
    name: 'Disk Volumes',
    command: 'Get-Volume',
    category: 'Windows',
    platform: 'windows',
    description: 'Daftar semua partisi/drive beserta sisa ruang penyimpanan di Windows.',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
];

const EMPTY: StoreFile = { version: 1, snippets: DEFAULT_SNIPPETS };

export class SnippetStore {
  private readonly path: string;
  private data: StoreFile;

  constructor(path = join(app.getPath('userData'), 'snippets.json')) {
    this.path = path;
    this.data = this.read();
  }

  private read(): StoreFile {
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as StoreFile;
      if (!Array.isArray(parsed.snippets)) return { ...EMPTY };

      // Normalisasi snippet agar selalu memiliki platform
      let mutated = false;
      for (const s of parsed.snippets) {
        if (!s.platform) {
          mutated = true;
          if (
            s.command.startsWith('systemctl') ||
            s.command.startsWith('sudo systemctl') ||
            s.command.startsWith('journalctl') ||
            s.command.startsWith('ss ') ||
            s.command.startsWith('df ') ||
            s.command.startsWith('free ') ||
            s.category === 'Systemd'
          ) {
            s.platform = 'linux';
          } else if (
            s.command.startsWith('Get-') ||
            s.command.startsWith('Restart-') ||
            s.command.startsWith('Test-') ||
            s.command.startsWith('ipconfig')
          ) {
            s.platform = 'windows';
          } else {
            s.platform = 'all';
          }
        }
      }

      // Pastikan ada snippet Windows bawaan jika sebelumnya belum ada
      const hasWindows = parsed.snippets.some((s) => s.platform === 'windows');
      if (!hasWindows) {
        mutated = true;
        const winDefaults = DEFAULT_SNIPPETS.filter((s) => s.platform === 'windows');
        parsed.snippets.push(...winDefaults);
      }

      if (mutated) {
        try {
          mkdirSync(dirname(this.path), { recursive: true });
          const temp = `${this.path}.tmp`;
          writeFileSync(temp, JSON.stringify(parsed, null, 2), { encoding: 'utf8', mode: 0o600 });
          renameSync(temp, this.path);
        } catch {
          // Abaikan jika tidak bisa menulis ulang saat baca
        }
      }

      return parsed;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        const initial = { ...EMPTY };
        try {
          mkdirSync(dirname(this.path), { recursive: true });
          writeFileSync(this.path, JSON.stringify(initial, null, 2), { encoding: 'utf8', mode: 0o600 });
        } catch {
          // Abaikan jika tidak bisa menulis berkas awal
        }
        return initial;
      }

      const backup = `${this.path}.corrupt-${Date.now()}`;
      try {
        renameSync(this.path, backup);
        console.error(`snippets.json rusak, disisihkan ke ${backup}`);
      } catch {
        /* jika gagal dipindahkan, tidak ada yang bisa diselamatkan */
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

  list(): CommandSnippet[] {
    return [...this.data.snippets].sort((a, b) => {
      const catCompare = a.category.localeCompare(b.category);
      if (catCompare !== 0) return catCompare;
      return a.name.localeCompare(b.name);
    });
  }

  get(id: string): CommandSnippet | undefined {
    return this.data.snippets.find((s) => s.id === id);
  }

  create(input: CommandSnippetCreateInput): CommandSnippet {
    const now = Date.now();
    const snippet: CommandSnippet = {
      id: randomUUID(),
      name: input.name.trim(),
      command: input.command.trim(),
      category: (input.category || 'General').trim(),
      platform: input.platform || 'all',
      description: input.description?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };
    this.data.snippets.push(snippet);
    this.flush();
    return snippet;
  }

  update(id: string, patch: CommandSnippetUpdatePatch): CommandSnippet | undefined {
    const snippet = this.data.snippets.find((s) => s.id === id);
    if (!snippet) return undefined;

    if (patch.name !== undefined) snippet.name = patch.name.trim();
    if (patch.command !== undefined) snippet.command = patch.command.trim();
    if (patch.category !== undefined) snippet.category = patch.category.trim();
    if (patch.platform !== undefined) snippet.platform = patch.platform;
    if (patch.description !== undefined) snippet.description = patch.description?.trim() || undefined;
    snippet.updatedAt = Date.now();

    this.flush();
    return snippet;
  }

  remove(id: string): void {
    this.data.snippets = this.data.snippets.filter((s) => s.id !== id);
    this.flush();
  }
}

export const snippetStore = new SnippetStore();
