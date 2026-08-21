import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { app } from 'electron';

import type { ProvisionTemplate } from '../../src/shared/types';

/**
 * Penyimpanan Provision Template — rangkaian langkah setup server (install
 * Docker, tools dasar, dst.) yang dipakai ulang lintas server, terpisah dari
 * DeployTemplate karena tidak pernah terikat ke Project/path manapun. Pola
 * sama dengan ProjectStore/PortForwardStore: satu berkas JSON, ditulis lewat
 * berkas sementara.
 */

interface StoreFile {
  version: 1;
  templates: ProvisionTemplate[];
}

const EMPTY: StoreFile = { version: 1, templates: [] };

/**
 * Template bawaan yang aman dijalankan ulang (idempotent) dan TIDAK
 * menyentuh autentikasi/firewall/akun — sengaja dihindari sebagai bawaan
 * karena salah konfigurasi di situ bisa mengunci pengguna dari server-nya
 * sendiri. Pengguna yang mau langkah seperti itu bisa menambahkannya
 * sendiri lewat editor, dengan sadar apa yang mereka jalankan.
 */
const DEFAULT_TEMPLATES: Array<{
  name: string;
  description: string;
  steps: Array<{ label: string; command: string }>;
}> = [
  {
    name: 'Update & Tools Dasar',
    description: 'Update package list, upgrade sistem, pasang tools dasar (git, curl, unzip, htop, ufw). Aman dijalankan ulang.',
    steps: [
      { label: 'Update package list', command: 'sudo apt-get update -y' },
      { label: 'Upgrade sistem', command: 'sudo apt-get upgrade -y' },
      { label: 'Install tools dasar', command: 'sudo apt-get install -y git curl unzip htop ufw' },
    ],
  },
  {
    name: 'Install Docker',
    description: 'Pasang Docker Engine + Compose plugin lewat convenience script resmi, lalu tambahkan pengguna ini ke grup docker (perlu login ulang SSH supaya berlaku).',
    steps: [
      { label: 'Install Docker Engine', command: 'curl -fsSL https://get.docker.com | sudo sh' },
      { label: 'Tambahkan user ke grup docker', command: 'sudo usermod -aG docker "$USER"' },
    ],
  },
  {
    name: 'Install Node.js (NVM)',
    description: 'Pasang NVM lalu Node.js versi LTS terbaru untuk user yang sedang login.',
    steps: [
      {
        label: 'Install NVM',
        command: 'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash',
      },
      {
        label: 'Install Node.js LTS',
        command:
          'export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && \\. "$NVM_DIR/nvm.sh"; nvm install --lts',
      },
    ],
  },
  {
    name: 'Install PHP (+ Composer)',
    description: 'Pasang PHP-FPM + ekstensi umum yang dibutuhkan CodeIgniter 4/Laravel (mysql, mbstring, xml, curl, zip, gd, bcmath, intl) lewat PPA ondrej/php, lalu Composer. Ganti "php8.3" di step kedua kalau butuh versi lain.',
    steps: [
      {
        label: 'Tambah PPA PHP (ondrej)',
        command:
          'sudo apt-get install -y software-properties-common && sudo add-apt-repository -y ppa:ondrej/php && sudo apt-get update -y',
      },
      {
        label: 'Install PHP-FPM + ekstensi',
        command:
          'sudo apt-get install -y php8.3-fpm php8.3-cli php8.3-mysql php8.3-mbstring php8.3-xml php8.3-curl php8.3-zip php8.3-gd php8.3-bcmath php8.3-intl',
      },
      {
        label: 'Install Composer',
        command:
          'curl -sS https://getcomposer.org/installer | sudo php -- --install-dir=/usr/local/bin --filename=composer',
      },
    ],
  },
  {
    name: 'Install MySQL',
    description: 'Pasang MySQL Server dan aktifkan service-nya. Pembuatan database/user aplikasi sengaja tidak disertakan — tambahkan sendiri sebagai step kalau mau, karena itu spesifik per aplikasi.',
    steps: [
      { label: 'Install MySQL Server', command: 'sudo apt-get install -y mysql-server' },
      { label: 'Aktifkan & jalankan MySQL', command: 'sudo systemctl enable --now mysql' },
    ],
  },
  {
    name: 'Install Nginx',
    description: 'Pasang Nginx, aktifkan service-nya, dan izinkan di firewall (ufw) kalau ufw sudah terpasang. Config vhost per-aplikasi (root Laravel di "public/", socket PHP-FPM, dst.) perlu disesuaikan manual.',
    steps: [
      { label: 'Install Nginx', command: 'sudo apt-get install -y nginx' },
      { label: 'Aktifkan & jalankan Nginx', command: 'sudo systemctl enable --now nginx' },
      { label: 'Izinkan Nginx di firewall (ufw)', command: "sudo ufw allow 'Nginx Full' 2>/dev/null || true" },
    ],
  },
];

export class ProvisionTemplateStore {
  private readonly path: string;
  private data: StoreFile;

  constructor(path = join(app.getPath('userData'), 'provision-templates.json')) {
    this.path = path;
    this.data = this.read();
    this.seedDefaultTemplates();
  }

  private seedDefaultTemplates(): void {
    const existingNames = new Set(this.data.templates.map((t) => t.name));
    let changed = false;
    for (const def of DEFAULT_TEMPLATES) {
      if (existingNames.has(def.name)) continue;
      this.data.templates.push({
        id: randomUUID(),
        name: def.name,
        description: def.description,
        steps: def.steps.map((step) => ({ id: randomUUID(), ...step })),
        createdAt: Date.now(),
      });
      changed = true;
    }
    if (changed) this.flush();
  }

  private read(): StoreFile {
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as StoreFile;
      if (!Array.isArray(parsed.templates)) return { ...EMPTY };
      return parsed;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return { ...EMPTY };
      const backup = `${this.path}.corrupt-${Date.now()}`;
      try {
        renameSync(this.path, backup);
        console.error(`provision-templates.json tidak terbaca, disisihkan ke ${backup}`);
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

  list(): ProvisionTemplate[] {
    return [...this.data.templates].sort((a, b) => a.name.localeCompare(b.name));
  }

  get(id: string): ProvisionTemplate | undefined {
    return this.data.templates.find((t) => t.id === id);
  }

  create(input: Pick<ProvisionTemplate, 'name' | 'description'>): ProvisionTemplate {
    const template: ProvisionTemplate = {
      id: randomUUID(),
      name: input.name,
      description: input.description,
      steps: [],
      createdAt: Date.now(),
    };
    this.data.templates.push(template);
    this.flush();
    return template;
  }

  update(
    id: string,
    patch: Partial<Pick<ProvisionTemplate, 'name' | 'description' | 'steps'>>,
  ): ProvisionTemplate | undefined {
    const template = this.data.templates.find((t) => t.id === id);
    if (!template) return undefined;
    Object.assign(template, patch, { id: template.id });
    this.flush();
    return template;
  }

  remove(id: string): void {
    this.data.templates = this.data.templates.filter((t) => t.id !== id);
    this.flush();
  }
}

export const provisionTemplates = new ProvisionTemplateStore();
