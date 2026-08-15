import { contextBridge, ipcRenderer } from 'electron';
import type { EditStatus } from './ssh/remote-edit';
import type { LockStatus, VerifyResult } from './app-lock';
import type { SshPreferences, SftpPreferences } from './store/preferences';
import type {
  ConnectionStatus,
  LocalTerminalProfile,
  MonitorSnapshot,
  RemoteFile,
  SessionConfig,
  Secret,
  TransferProgress,
} from '../src/shared/types';

/**
 * contextIsolation aktif dan nodeIntegration mati, jadi renderer hanya bisa
 * memanggil fungsi yang terdaftar di sini. Jangan pernah mengekspos ipcRenderer
 * mentah — itu membuat setiap skrip di halaman bisa memanggil channel apa pun.
 */

type Unsubscribe = () => void;

function subscribe<T>(channel: string, handler: (payload: T) => void): Unsubscribe {
  const listener = (_event: unknown, payload: T) => handler(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api = {
  appLock: {
    status: (): Promise<LockStatus> => ipcRenderer.invoke('applock:status'),
    setup: (pin: string): Promise<LockStatus> => ipcRenderer.invoke('applock:setup', pin),
    verify: (pin: string): Promise<VerifyResult> => ipcRenderer.invoke('applock:verify', pin),
    changePin: (currentPin: string, newPin: string): Promise<VerifyResult> =>
      ipcRenderer.invoke('applock:changePin', currentPin, newPin),
    disable: (currentPin: string): Promise<VerifyResult> =>
      ipcRenderer.invoke('applock:disable', currentPin),
  },

  settings: {
    sshGet: (): Promise<SshPreferences> => ipcRenderer.invoke('settings:sshGet'),
    sshUpdate: (patch: Partial<SshPreferences>): Promise<SshPreferences> =>
      ipcRenderer.invoke('settings:sshUpdate', patch),
    sshReset: (): Promise<SshPreferences> => ipcRenderer.invoke('settings:sshReset'),
    sftpGet: (): Promise<SftpPreferences> => ipcRenderer.invoke('settings:sftpGet'),
    sftpUpdate: (patch: Partial<SftpPreferences>): Promise<SftpPreferences> =>
      ipcRenderer.invoke('settings:sftpUpdate', patch),
    sftpReset: (): Promise<SftpPreferences> => ipcRenderer.invoke('settings:sftpReset'),
  },

  sessions: {
    list: (): Promise<SessionConfig[]> => ipcRenderer.invoke('sessions:list'),
    create: (config: Omit<SessionConfig, 'id' | 'createdAt'>, secret?: Secret) =>
      ipcRenderer.invoke('sessions:create', config, secret),
    update: (id: string, patch: Partial<SessionConfig>, secret?: Secret) =>
      ipcRenderer.invoke('sessions:update', id, patch, secret),
    remove: (id: string) => ipcRenderer.invoke('sessions:remove', id),
  },

  ssh: {
    connect: (sessionId: string): Promise<string> =>
      ipcRenderer.invoke('ssh:connect', sessionId),
    disconnect: (sessionId: string) => ipcRenderer.invoke('ssh:disconnect', sessionId),
    status: (sessionId: string): Promise<ConnectionStatus> =>
      ipcRenderer.invoke('ssh:status', sessionId),
    respondToHostKey: (promptId: string, trust: boolean) =>
      ipcRenderer.invoke('ssh:hostKeyResponse', promptId, trust),
    onStatus: (handler: (p: { sessionId: string; status: string; detail?: string }) => void) =>
      subscribe('ssh:status', handler),
    onHostKeyPrompt: (handler: (p: Record<string, unknown>) => void) =>
      subscribe('ssh:hostKeyPrompt', handler),
  },

  shell: {
    open: (sessionId: string, cols: number, rows: number): Promise<string> =>
      ipcRenderer.invoke('shell:open', sessionId, cols, rows),
    write: (terminalId: string, data: string) =>
      ipcRenderer.send('shell:write', terminalId, data),
    resize: (terminalId: string, cols: number, rows: number) =>
      ipcRenderer.send('shell:resize', terminalId, cols, rows),
    close: (terminalId: string) => ipcRenderer.send('shell:close', terminalId),
    onData: (handler: (p: { terminalId: string; data: string }) => void) =>
      subscribe('shell:data', handler),
    onClose: (handler: (p: { terminalId: string }) => void) => subscribe('shell:close', handler),
  },

  local: {
    list: (): Promise<LocalTerminalProfile[]> => ipcRenderer.invoke('local:list'),
    open: (profileId: string, cols: number, rows: number): Promise<string> =>
      ipcRenderer.invoke('local:open', profileId, cols, rows),
    write: (terminalId: string, data: string) =>
      ipcRenderer.send('local:write', terminalId, data),
    resize: (terminalId: string, cols: number, rows: number) =>
      ipcRenderer.send('local:resize', terminalId, cols, rows),
    close: (terminalId: string) => ipcRenderer.send('local:close', terminalId),
    onData: (handler: (p: { terminalId: string; data: string }) => void) =>
      subscribe('local:data', handler),
    onClose: (handler: (p: { terminalId: string; exitCode: number }) => void) =>
      subscribe('local:close', handler),
  },

  sftp: {
    realpath: (sessionId: string, path: string): Promise<string> =>
      ipcRenderer.invoke('sftp:realpath', sessionId, path),
    list: (sessionId: string, path: string): Promise<RemoteFile[]> =>
      ipcRenderer.invoke('sftp:list', sessionId, path),
    download: (sessionId: string, remotePath: string, localPath: string, sizeBytes: number) =>
      ipcRenderer.invoke('sftp:download', sessionId, remotePath, localPath, sizeBytes),
    upload: (sessionId: string, localPath: string, remotePath: string) =>
      ipcRenderer.invoke('sftp:upload', sessionId, localPath, remotePath),
    remove: (sessionId: string, path: string, isDir: boolean) =>
      ipcRenderer.invoke('sftp:remove', sessionId, path, isDir),
    rename: (sessionId: string, from: string, to: string) =>
      ipcRenderer.invoke('sftp:rename', sessionId, from, to),
    onProgress: (handler: (p: TransferProgress) => void) => subscribe('sftp:progress', handler),
  },

  sshConfig: {
    scan: (): Promise<
      Array<{
        alias: string;
        host: string;
        port: number;
        username?: string;
        identityFile?: string;
        proxyJump?: string;
        alreadyImported: boolean;
      }>
    > => ipcRenderer.invoke('sshconfig:scan'),
    import: (aliases: string[], group?: string): Promise<{ imported: number; linked: number }> =>
      ipcRenderer.invoke('sshconfig:import', aliases, group),
  },

  dialog: {
    pickUpload: (): Promise<string[]> => ipcRenderer.invoke('dialog:pickUpload'),
    pickDownload: (suggestedName: string): Promise<string | null> =>
      ipcRenderer.invoke('dialog:pickDownload', suggestedName),
    pickFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickFolder'),
  },

  edit: {
    open: (sessionId: string, remotePath: string, sizeBytes: number): Promise<string> =>
      ipcRenderer.invoke('edit:open', sessionId, remotePath, sizeBytes),
    list: (sessionId?: string): Promise<EditStatus[]> => ipcRenderer.invoke('edit:list', sessionId),
    close: (editId: string) => ipcRenderer.invoke('edit:close', editId),
    onStatus: (handler: (status: EditStatus) => void) => subscribe('edit:status', handler),
  },

  monitor: {
    start: (sessionId: string, intervalMs?: number) =>
      ipcRenderer.invoke('monitor:start', sessionId, intervalMs),
    stop: (sessionId: string) => ipcRenderer.invoke('monitor:stop', sessionId),
    onSnapshot: (handler: (p: { sessionId: string; snapshot: MonitorSnapshot }) => void) =>
      subscribe('monitor:snapshot', handler),
    onError: (handler: (p: { sessionId: string; message: string }) => void) =>
      subscribe('monitor:error', handler),
  },
};

contextBridge.exposeInMainWorld('ssh', api);

export type SshApi = typeof api;
