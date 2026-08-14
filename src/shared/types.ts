// Tipe yang dipakai bersama oleh proses main (Electron) dan renderer (React).
// Simpan di satu tempat supaya IPC tetap type-safe di kedua sisi.

export type AuthMethod = 'password' | 'privateKey' | 'agent';

export interface SessionConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authMethod: AuthMethod;
  /** Path absolut ke private key. Hanya dipakai saat authMethod === 'privateKey'. */
  privateKeyPath?: string;
  /** Folder untuk pengelompokan di sidebar, mis. "Produksi/Web". */
  group?: string;
  /** Warna label heksadesimal, membantu membedakan server prod vs dev sekilas. */
  color?: string;
  /** id session lain yang dipakai sebagai bastion/jump host. */
  jumpHostId?: string;
  createdAt: number;
  lastUsedAt?: number;
}

/** Password dan passphrase TIDAK PERNAH ikut di SessionConfig. */
export interface Secret {
  password?: string;
  passphrase?: string;
}

export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

export interface HostKeyPrompt {
  sessionId: string;
  host: string;
  port: number;
  keyType: string;
  /** Fingerprint SHA256 base64, format sama dengan output ssh-keygen -lf. */
  fingerprint: string;
  /** true jika host sudah ada di known_hosts tapi key-nya BERBEDA. */
  changed: boolean;
}

export interface CpuSample {
  usagePercent: number;
  cores: number;
  loadAvg: [number, number, number];
}

export interface MemSample {
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  swapTotalBytes: number;
  swapUsedBytes: number;
}

export interface DiskSample {
  filesystem: string;
  mount: string;
  totalBytes: number;
  usedBytes: number;
}

export interface NetSample {
  iface: string;
  rxBytesPerSec: number;
  txBytesPerSec: number;
}

export interface ProcessSample {
  pid: number;
  user: string;
  cpuPercent: number;
  memPercent: number;
  command: string;
}

export interface MonitorSnapshot {
  takenAt: number;
  uptimeSeconds: number;
  cpu: CpuSample;
  mem: MemSample;
  disks: DiskSample[];
  net: NetSample[];
  processes: ProcessSample[];
}

export interface RemoteFile {
  name: string;
  path: string;
  isDirectory: boolean;
  isSymlink: boolean;
  sizeBytes: number;
  modifiedAt: number;
  /** Mode oktal, mis. "0644". */
  mode: string;
  owner: number;
  group: number;
}

export interface TransferProgress {
  transferId: string;
  filename: string;
  transferredBytes: number;
  totalBytes: number;
  direction: 'upload' | 'download';
}


export type LocalTerminalKind = 'powershell' | 'cmd' | 'wsl';

export interface LocalTerminalProfile {
  id: string;
  name: string;
  kind: LocalTerminalKind;
  command: string;
  args: string[];
  detail?: string;
}

export interface LocalTerminalWorkspace {
  id: string;
  profile: LocalTerminalProfile;
  createdAt: number;
}
