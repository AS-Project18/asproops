import type { SessionChannels } from './connection-manager';
import type { ContainerAction, DockerContainerInfo } from '../../src/shared/types';

/**
 * Docker container manager — daftar dan start/stop/restart container lewat
 * `docker ps -a --format '{{json .}}'` (satu objek JSON per baris, jauh
 * lebih andal diparsing daripada kolom tabel default yang lebarnya berubah
 * tergantung isi).
 */

const LIST_COMMAND = "docker ps -a --format '{{json .}}'";

const ALLOWED_ACTIONS: readonly ContainerAction[] = ['start', 'stop', 'restart'];

interface DockerPsLine {
  ID: string;
  Names: string;
  Image: string;
  Command: string;
  Status: string;
  State: string;
  Ports: string;
}

function parseContainerList(stdout: string): DockerContainerInfo[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      let raw: DockerPsLine;
      try {
        raw = JSON.parse(line) as DockerPsLine;
      } catch {
        return [];
      }
      return [
        {
          id: raw.ID,
          name: raw.Names,
          image: raw.Image,
          command: raw.Command,
          status: raw.Status,
          state: raw.State,
          ports: raw.Ports,
        },
      ];
    });
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * stderr sengaja TIDAK dibuang — kalau Docker tidak terpasang atau pengguna
 * ini tidak punya akses ke docker.sock, `docker ps` gagal dengan exit code
 * bukan 0. Tanpa cek ini, panel akan diam-diam menampilkan "tidak ada
 * container" alih-alih menjelaskan sebabnya (pola sama seperti services.ts).
 */
export async function listContainers(connection: SessionChannels): Promise<DockerContainerInfo[]> {
  const { stdout, stderr, code } = await connection.exec(LIST_COMMAND);
  if (code !== 0) {
    throw new Error(
      stderr.trim() ||
        'docker gagal dijalankan. Pastikan Docker terpasang dan pengguna ini punya akses ke docker.sock.',
    );
  }
  return parseContainerList(stdout);
}

/**
 * start/stop/restart butuh akses ke docker.sock. Dicoba langsung dulu (mis.
 * pengguna ini sudah anggota grup "docker"); kalau ditolak, dicoba ulang
 * lewat `sudo -n` non-interaktif — sama pendekatannya dengan
 * runServiceAction di services.ts.
 */
export async function runContainerAction(
  connection: SessionChannels,
  id: string,
  action: ContainerAction,
): Promise<void> {
  if (!ALLOWED_ACTIONS.includes(action)) {
    throw new Error(`Aksi tidak dikenal: ${action}`);
  }

  const quoted = shellQuote(id);
  const direct = await connection.exec(`docker ${action} -- ${quoted} 2>&1`);
  if (direct.code === 0) return;

  const viaSudo = await connection.exec(`sudo -n docker ${action} -- ${quoted} 2>&1`);
  if (viaSudo.code === 0) return;

  const detail = (viaSudo.stdout || direct.stdout || `docker ${action} gagal.`).trim();
  throw new Error(
    `${detail}\n\nPerlu akses Docker. Tambahkan pengguna ini ke grup "docker", atau siapkan sudo ` +
      'tanpa password (NOPASSWD) untuk docker.',
  );
}

export function buildContainerLogsCommand(id: string): string {
  return `docker logs -f --tail 200 -- ${shellQuote(id)} 2>&1`;
}
