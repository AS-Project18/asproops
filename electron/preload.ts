import { clipboard, contextBridge, ipcRenderer, webUtils } from 'electron';
import type { EditStatus } from './ssh/remote-edit';
import type { LockStatus, VerifyResult } from './app-lock';
import type { SshPreferences, SftpPreferences } from './store/preferences';
import type {
  AuthLogOpenResult,
  AuthLogQueryResult,
  ConnectionStatus,
  ContainerAction,
  CronJob,
  DeployHistoryEntry,
  DeployRunEvent,
  DeployTemplate,
  DockerContainerInfo,
  EnvFileResult,
  GitAction,
  GitStatus,
  LocalTerminalProfile,
  MonitorSnapshot,
  PortForwardRule,
  PortForwardStatus,
  ProjectProfile,
  ProvisionRunEvent,
  ProvisionTemplate,
  RemoteFile,
  ServiceAction,
  ServiceInfo,
  SessionConfig,
  Secret,
  TransferProgress,
  UpdateCheckResult,
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
  // navigator.clipboard.readText() tidak konsisten di Electron (butuh fokus
  // dokumen tertentu dan bisa ditolak diam-diam) — modul clipboard Electron
  // langsung tersedia di preload karena sandbox:false, jadi dipakai di sini
  // supaya copy/paste terminal dan log selalu bekerja.
  clipboard: {
    readText: (): string => clipboard.readText(),
    writeText: (text: string): void => clipboard.writeText(text),
  },

  // File.path dihapus Electron sejak v32 demi keamanan — path asli file yang
  // di-drag hanya bisa diambil lewat webUtils di sisi preload/main, jadi
  // renderer perlu jembatan ini untuk drag-and-drop file ke terminal.
  file: {
    getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  },

  app: {
    getVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),
    checkUpdate: (): Promise<UpdateCheckResult> => ipcRenderer.invoke('app:checkUpdate'),
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('app:openExternal', url),
  },

  appLock: {
    status: (): Promise<LockStatus> => ipcRenderer.invoke('applock:status'),
    setup: (pin: string): Promise<LockStatus> => ipcRenderer.invoke('applock:setup', pin),
    verify: (pin: string): Promise<VerifyResult> => ipcRenderer.invoke('applock:verify', pin),
    changePin: (currentPin: string, newPin: string): Promise<VerifyResult> =>
      ipcRenderer.invoke('applock:changePin', currentPin, newPin),
    disable: (currentPin: string): Promise<VerifyResult> =>
      ipcRenderer.invoke('applock:disable', currentPin),
    relock: (): Promise<void> => ipcRenderer.invoke('applock:relock'),
    setIdleMinutes: (minutes: number): Promise<LockStatus> =>
      ipcRenderer.invoke('applock:setIdleMinutes', minutes),
    onChanged: (handler: (status: LockStatus) => void) => subscribe('applock:changed', handler),
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

  projects: {
    detectLogs: (sessionId: string, path: string): Promise<string[]> =>
      ipcRenderer.invoke('projects:detectLogs', sessionId, path),
    list: (sessionId: string): Promise<ProjectProfile[]> =>
      ipcRenderer.invoke('projects:list', sessionId),
    create: (
      sessionId: string,
      input: Pick<ProjectProfile, 'name' | 'path' | 'env' | 'deployTemplateId'> &
        Partial<Pick<ProjectProfile, 'logPaths' | 'serviceNames'>>,
    ): Promise<ProjectProfile> => ipcRenderer.invoke('projects:create', sessionId, input),
    update: (id: string, patch: Partial<ProjectProfile>): Promise<ProjectProfile | undefined> =>
      ipcRenderer.invoke('projects:update', id, patch),
    remove: (id: string) => ipcRenderer.invoke('projects:remove', id),
  },

  templates: {
    list: (): Promise<DeployTemplate[]> => ipcRenderer.invoke('templates:list'),
    create: (input: Pick<DeployTemplate, 'name' | 'description'>): Promise<DeployTemplate> =>
      ipcRenderer.invoke('templates:create', input),
    update: (
      id: string,
      patch: Partial<Pick<DeployTemplate, 'name' | 'description' | 'steps'>>,
    ): Promise<DeployTemplate | undefined> => ipcRenderer.invoke('templates:update', id, patch),
    remove: (id: string) => ipcRenderer.invoke('templates:remove', id),
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

  log: {
    open: (sessionId: string, path: string): Promise<string> =>
      ipcRenderer.invoke('log:open', sessionId, path),
    close: (tailId: string) => ipcRenderer.send('log:close', tailId),
    onData: (handler: (p: { tailId: string; data: string }) => void) =>
      subscribe('log:data', handler),
    onClose: (handler: (p: { tailId: string }) => void) => subscribe('log:close', handler),
  },

  /**
   * Log login SSH milik server (journalctl/auth.log) — beda dari `log.*` di
   * atas yang untuk tail berkas log project. Stream yang berhasil dibuka
   * tetap lewat event log:data/log:close/log.close yang sama, jadi
   * penampilnya bisa dipakai ulang.
   */
  authLog: {
    open: (sessionId: string): Promise<AuthLogOpenResult> =>
      ipcRenderer.invoke('authlog:open', sessionId),
    openWithPassword: (sessionId: string, password: string): Promise<AuthLogOpenResult> =>
      ipcRenderer.invoke('authlog:openWithPassword', sessionId, password),
    /** Query histori sekali-jalan (bukan stream) untuk rentang tanggal [sinceMs, untilMs]. */
    query: (sessionId: string, sinceMs: number, untilMs: number): Promise<AuthLogQueryResult> =>
      ipcRenderer.invoke('authlog:query', sessionId, sinceMs, untilMs),
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

  service: {
    list: (sessionId: string): Promise<ServiceInfo[]> =>
      ipcRenderer.invoke('service:list', sessionId),
    action: (sessionId: string, unit: string, action: ServiceAction): Promise<void> =>
      ipcRenderer.invoke('service:action', sessionId, unit, action),
  },

  docker: {
    list: (sessionId: string): Promise<DockerContainerInfo[]> =>
      ipcRenderer.invoke('docker:list', sessionId),
    action: (sessionId: string, id: string, action: ContainerAction): Promise<void> =>
      ipcRenderer.invoke('docker:action', sessionId, id, action),
    /** Stream log container lewat channel log:data/log:close yang sama dengan LogView/AuthLogPanel. */
    openLogs: (sessionId: string, id: string): Promise<string> =>
      ipcRenderer.invoke('docker:openLogs', sessionId, id),
  },

  cron: {
    list: (sessionId: string): Promise<CronJob[]> => ipcRenderer.invoke('cron:list', sessionId),
    create: (sessionId: string, input: { schedule: string; command: string }): Promise<void> =>
      ipcRenderer.invoke('cron:create', sessionId, input),
    update: (
      sessionId: string,
      index: number,
      input: { schedule: string; command: string; enabled: boolean },
    ): Promise<void> => ipcRenderer.invoke('cron:update', sessionId, index, input),
    remove: (sessionId: string, index: number): Promise<void> =>
      ipcRenderer.invoke('cron:remove', sessionId, index),
  },

  portForward: {
    listRules: (sessionId: string): Promise<PortForwardRule[]> =>
      ipcRenderer.invoke('portforward:listRules', sessionId),
    createRule: (
      sessionId: string,
      input: Pick<
        PortForwardRule,
        'name' | 'direction' | 'localHost' | 'localPort' | 'remoteHost' | 'remotePort'
      >,
    ): Promise<PortForwardRule> => ipcRenderer.invoke('portforward:createRule', sessionId, input),
    updateRule: (id: string, patch: Partial<PortForwardRule>): Promise<PortForwardRule | undefined> =>
      ipcRenderer.invoke('portforward:updateRule', id, patch),
    removeRule: (id: string): Promise<void> => ipcRenderer.invoke('portforward:removeRule', id),
    start: (ruleId: string): Promise<string> => ipcRenderer.invoke('portforward:start', ruleId),
    stop: (tunnelId: string): Promise<void> => ipcRenderer.invoke('portforward:stop', tunnelId),
    listActive: (sessionId: string): Promise<PortForwardStatus[]> =>
      ipcRenderer.invoke('portforward:listActive', sessionId),
    onStatus: (handler: (status: PortForwardStatus) => void) =>
      subscribe('portforward:status', handler),
  },

  git: {
    status: (sessionId: string, path: string): Promise<GitStatus> =>
      ipcRenderer.invoke('git:status', sessionId, path),
    action: (sessionId: string, path: string, action: GitAction): Promise<string> =>
      ipcRenderer.invoke('git:action', sessionId, path, action),
  },

  env: {
    read: (sessionId: string, path: string): Promise<EnvFileResult> =>
      ipcRenderer.invoke('env:read', sessionId, path),
    write: (sessionId: string, path: string, content: string): Promise<void> =>
      ipcRenderer.invoke('env:write', sessionId, path, content),
  },

  deploy: {
    run: (sessionId: string, projectId: string): Promise<string> =>
      ipcRenderer.invoke('deploy:run', sessionId, projectId),
    rollback: (sessionId: string, projectId: string, entryId: string): Promise<string> =>
      ipcRenderer.invoke('deploy:rollback', sessionId, projectId, entryId),
    cancel: (runId: string) => ipcRenderer.send('deploy:cancel', runId),
    onEvent: (handler: (event: DeployRunEvent) => void) => subscribe('deploy:event', handler),
    listHistory: (projectId: string): Promise<DeployHistoryEntry[]> =>
      ipcRenderer.invoke('deploy:listHistory', projectId),
    onHistoryChanged: (handler: (projectId: string) => void) =>
      subscribe('deploy:historyChanged', handler),
  },

  provision: {
    listTemplates: (): Promise<ProvisionTemplate[]> =>
      ipcRenderer.invoke('provision:listTemplates'),
    createTemplate: (input: Pick<ProvisionTemplate, 'name' | 'description'>): Promise<ProvisionTemplate> =>
      ipcRenderer.invoke('provision:createTemplate', input),
    updateTemplate: (
      id: string,
      patch: Partial<Pick<ProvisionTemplate, 'name' | 'description' | 'steps'>>,
    ): Promise<ProvisionTemplate | undefined> => ipcRenderer.invoke('provision:updateTemplate', id, patch),
    removeTemplate: (id: string) => ipcRenderer.invoke('provision:removeTemplate', id),
    run: (sessionId: string, templateId: string): Promise<string> =>
      ipcRenderer.invoke('provision:run', sessionId, templateId),
    cancel: (runId: string) => ipcRenderer.send('provision:cancel', runId),
    onEvent: (handler: (event: ProvisionRunEvent) => void) => subscribe('provision:event', handler),
  },
};

contextBridge.exposeInMainWorld('ssh', api);

export type SshApi = typeof api;
