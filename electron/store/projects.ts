import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { app } from 'electron';

import type { ProjectProfile, DeployTemplate, DeployStep } from '../../src/shared/types';

/**
 * Penyimpanan Project (working directory per-server) dan DeployTemplate
 * (rangkaian langkah deploy yang dipakai ulang lintas server).
 *
 * Satu berkas JSON, pola sama dengan SessionStore: tulis lewat berkas
 * sementara supaya tidak ada tulisan setengah jadi, dan sisihkan salinan
 * kalau berkasnya rusak alih-alih menimpanya diam-diam. Tidak ada
 * kredensial di sini sama sekali, jadi tidak perlu enkripsi seperti
 * sessions.json.
 */

interface StoreFile {
  version: 1;
  projects: ProjectProfile[];
  templates: DeployTemplate[];
}

const EMPTY: StoreFile = { version: 1, projects: [], templates: [] };

/**
 * Template bawaan untuk stack yang umum dipakai — titik awal yang masuk
 * akal, bukan preskriptif. Dicocokkan lewat nama supaya idempoten: aman
 * dipanggil ulang setiap start tanpa membuat duplikat, dan tidak menimpa
 * kalau pengguna sudah mengubah/menghapus salah satunya.
 */
const DEFAULT_TEMPLATES: Array<{
  name: string;
  description: string;
  steps: Array<{ label: string; command: string }>;
}> = [
  {
    name: 'CodeIgniter 4',
    description: 'Pull, install dependencies, migrasi, bersihkan cache. Sesuaikan step restart (PHP-FPM/systemd) dengan setup server.',
    steps: [
      { label: 'Pull terbaru', command: 'git pull' },
      { label: 'Install dependencies', command: 'composer install --no-dev --optimize-autoloader' },
      { label: 'Jalankan migrasi', command: 'php spark migrate --all' },
      { label: 'Bersihkan cache', command: 'php spark cache:clear' },
    ],
  },
  {
    name: 'Laravel',
    description: 'Pull, install dependencies, migrasi, build asset, optimize cache. Sesuaikan step restart (queue/php-fpm) dengan setup server.',
    steps: [
      { label: 'Pull terbaru', command: 'git pull' },
      { label: 'Install dependencies (Composer)', command: 'composer install --no-dev --optimize-autoloader' },
      { label: 'Install dependencies (NPM)', command: 'npm ci' },
      { label: 'Jalankan migrasi', command: 'php artisan migrate --force' },
      { label: 'Build asset', command: 'npm run build' },
      { label: 'Optimize cache', command: 'php artisan config:cache && php artisan route:cache' },
    ],
  },
  {
    name: 'Vue',
    description: 'Pull, install dependencies, build produksi. Untuk SPA statis — tidak ada langkah restart proses.',
    steps: [
      { label: 'Pull terbaru', command: 'git pull' },
      { label: 'Install dependencies', command: 'npm ci' },
      { label: 'Build produksi', command: 'npm run build' },
    ],
  },
  {
    name: 'NestJS',
    description: 'Pull, install dependencies, build, restart lewat PM2. Sesuaikan nama app/step restart (PM2/systemd) dengan setup server — "pm2 restart all" me-restart SEMUA app PM2 di server, ganti ke nama app spesifik kalau server ini dipakai bersama.',
    steps: [
      { label: 'Pull terbaru', command: 'git pull' },
      { label: 'Install dependencies', command: 'npm ci' },
      { label: 'Build', command: 'npm run build' },
      { label: 'Restart service (PM2)', command: 'pm2 restart all' },
    ],
  },
];

export class ProjectStore {
  private readonly path: string;
  private data: StoreFile;

  constructor(path = join(app.getPath('userData'), 'projects.json')) {
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
      if (!Array.isArray(parsed.projects) || !Array.isArray(parsed.templates)) {
        return { ...EMPTY };
      }
      return parsed;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return { ...EMPTY };
      const backup = `${this.path}.corrupt-${Date.now()}`;
      try {
        renameSync(this.path, backup);
        console.error(`projects.json tidak terbaca, disisihkan ke ${backup}`);
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

  // --- Projects -------------------------------------------------------------

  listProjects(sessionId: string): ProjectProfile[] {
    return this.data.projects
      .filter((p) => p.sessionId === sessionId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  getProject(id: string): ProjectProfile | undefined {
    return this.data.projects.find((p) => p.id === id);
  }

  createProject(
    sessionId: string,
    input: Pick<ProjectProfile, 'name' | 'path' | 'env' | 'deployTemplateId'> &
      Partial<Pick<ProjectProfile, 'logPaths' | 'serviceNames'>>,
  ): ProjectProfile {
    const project: ProjectProfile = {
      id: randomUUID(),
      sessionId,
      name: input.name,
      path: input.path,
      env: input.env ?? {},
      logPaths: input.logPaths ?? [],
      serviceNames: input.serviceNames ?? [],
      deployTemplateId: input.deployTemplateId,
      createdAt: Date.now(),
    };
    this.data.projects.push(project);
    this.flush();
    return project;
  }

  updateProject(id: string, patch: Partial<ProjectProfile>): ProjectProfile | undefined {
    const project = this.data.projects.find((p) => p.id === id);
    if (!project) return undefined;
    Object.assign(project, patch, { id: project.id, sessionId: project.sessionId });
    this.flush();
    return project;
  }

  removeProject(id: string): void {
    this.data.projects = this.data.projects.filter((p) => p.id !== id);
    this.flush();
  }

  /** Dipanggil saat sebuah session dihapus — project-nya sudah tidak punya tempat. */
  removeProjectsForSession(sessionId: string): void {
    this.data.projects = this.data.projects.filter((p) => p.sessionId !== sessionId);
    this.flush();
  }

  // --- Deploy templates -------------------------------------------------------

  listTemplates(): DeployTemplate[] {
    return [...this.data.templates].sort((a, b) => a.name.localeCompare(b.name));
  }

  getTemplate(id: string): DeployTemplate | undefined {
    return this.data.templates.find((t) => t.id === id);
  }

  createTemplate(input: Pick<DeployTemplate, 'name' | 'description'>): DeployTemplate {
    const template: DeployTemplate = {
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

  updateTemplate(
    id: string,
    patch: Partial<Pick<DeployTemplate, 'name' | 'description' | 'steps'>>,
  ): DeployTemplate | undefined {
    const template = this.data.templates.find((t) => t.id === id);
    if (!template) return undefined;
    Object.assign(template, patch, { id: template.id });
    this.flush();
    return template;
  }

  removeTemplate(id: string): void {
    this.data.templates = this.data.templates.filter((t) => t.id !== id);
    // Lepaskan tautan di project yang masih menunjuk ke template ini, supaya
    // tidak ada project yang diam-diam menunjuk ke template yang sudah hilang.
    for (const project of this.data.projects) {
      if (project.deployTemplateId === id) project.deployTemplateId = undefined;
    }
    this.flush();
  }
}

export type { ProjectProfile, DeployTemplate, DeployStep };

export const projects = new ProjectStore();
