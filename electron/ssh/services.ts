import type { SessionChannels } from './connection-manager';
import type { ServiceAction, ServiceInfo } from '../../src/shared/types';

/**
 * Service manager berbasis systemd.
 *
 * `list-units` (bukan `list-unit-files`) dipakai supaya statusnya real-time
 * (active/inactive/failed) — bukan cuma status enable/disable di boot.
 */
const LIST_COMMAND =
  'systemctl list-units --type=service --all --no-legend --no-pager --plain 2>/dev/null';

const ALLOWED_ACTIONS: readonly ServiceAction[] = ['start', 'stop', 'restart'];

function parseServiceList(stdout: string): ServiceInfo[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      // UNIT LOAD ACTIVE SUB DESCRIPTION — deskripsi boleh mengandung spasi.
      const match = line.match(/^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s*(.*)$/);
      if (!match) return [];
      const [, name, loadState, activeState, subState, description] = match;
      return [{ name, loadState, activeState, subState, description }];
    });
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export async function listServices(connection: SessionChannels): Promise<ServiceInfo[]> {
  const { stdout } = await connection.exec(LIST_COMMAND);
  return parseServiceList(stdout);
}

/**
 * start/stop/restart butuh privilese root. Dicoba langsung dulu (kalau
 * session ini sudah login sebagai root, atau polkit mengizinkan tanpa
 * password); kalau ditolak, dicoba ulang lewat `sudo -n` — non-interaktif,
 * jadi gagal cepat alih-alih menggantung menunggu password yang tidak akan
 * pernah datang lewat channel exec ini.
 */
export async function runServiceAction(
  connection: SessionChannels,
  unit: string,
  action: ServiceAction,
): Promise<void> {
  if (!ALLOWED_ACTIONS.includes(action)) {
    throw new Error(`Aksi tidak dikenal: ${action}`);
  }

  const quoted = shellQuote(unit);
  const direct = await connection.exec(`systemctl ${action} -- ${quoted} 2>&1`);
  if (direct.code === 0) return;

  const viaSudo = await connection.exec(`sudo -n systemctl ${action} -- ${quoted} 2>&1`);
  if (viaSudo.code === 0) return;

  const detail = (viaSudo.stdout || direct.stdout || `systemctl ${action} gagal.`).trim();
  throw new Error(
    `${detail}\n\nPerlu akses root. Login sebagai root, atau siapkan sudo tanpa password ` +
      '(NOPASSWD) untuk systemctl.',
  );
}
