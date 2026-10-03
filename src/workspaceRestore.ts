import type {
  LocalProjectSummary,
  LocalTerminalProfile,
  LocalTerminalWorkspace,
  SessionConfig,
} from './shared/types';

export type WorkspaceLeftMode =
  | 'servers'
  | 'local'
  | 'files'
  | 'monitor'
  | 'projects'
  | 'ops'
  | 'provision'
  | 'portforward'
  | 'git'
  | 'authlog';

export type WorkspaceOpsTab = 'docker' | 'cron' | 'services';

export type WorkspaceActiveTarget =
  | { kind: 'dashboard' }
  | { kind: 'remote'; sessionId: string }
  | { kind: 'local'; workspaceId: string };

interface PersistedLocalWorkspace {
  id: string;
  profileId: string;
  projectId?: string;
}

export interface WorkspaceSnapshotV1 {
  version: 1;
  openSessions: string[];
  localWorkspaces: PersistedLocalWorkspace[];
  active: WorkspaceActiveTarget;
  layout: {
    leftMode: WorkspaceLeftMode;
    leftWidth: number;
    leftCollapsed: boolean;
    serverOpsTab: WorkspaceOpsTab;
  };
}

export interface SaveWorkspaceInput {
  openSessions: string[];
  localWorkspaces: LocalTerminalWorkspace[];
  active: WorkspaceActiveTarget;
  leftMode: WorkspaceLeftMode;
  leftWidth: number;
  leftCollapsed: boolean;
  serverOpsTab: WorkspaceOpsTab;
}

const STORAGE_KEY = 'asproops.workspace.v1';
const MAX_RESTORED_TABS = 40;
const MIN_LEFT_WIDTH = 260;
const MAX_LEFT_WIDTH = 680;

const LEFT_MODES = new Set<WorkspaceLeftMode>([
  'servers',
  'local',
  'files',
  'monitor',
  'projects',
  'ops',
  'provision',
  'portforward',
  'git',
  'authlog',
]);

const OPS_TABS = new Set<WorkspaceOpsTab>(['docker', 'cron', 'services']);

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function clampLeftWidth(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 330;
  return Math.max(MIN_LEFT_WIDTH, Math.min(MAX_LEFT_WIDTH, Math.round(numeric)));
}

function parseActive(value: unknown): WorkspaceActiveTarget {
  if (!value || typeof value !== 'object') return { kind: 'dashboard' };
  const record = value as Record<string, unknown>;

  if (record.kind === 'remote') {
    const sessionId = stringValue(record.sessionId);
    if (sessionId) return { kind: 'remote', sessionId };
  }

  if (record.kind === 'local') {
    const workspaceId = stringValue(record.workspaceId);
    if (workspaceId) return { kind: 'local', workspaceId };
  }

  return { kind: 'dashboard' };
}

export function loadWorkspaceSnapshot(): WorkspaceSnapshotV1 | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.version !== 1) return null;

    const layout =
      parsed.layout && typeof parsed.layout === 'object'
        ? (parsed.layout as Record<string, unknown>)
        : {};

    const leftMode = LEFT_MODES.has(layout.leftMode as WorkspaceLeftMode)
      ? (layout.leftMode as WorkspaceLeftMode)
      : 'servers';

    const serverOpsTab = OPS_TABS.has(layout.serverOpsTab as WorkspaceOpsTab)
      ? (layout.serverOpsTab as WorkspaceOpsTab)
      : 'docker';

    const openSessions = Array.isArray(parsed.openSessions)
      ? parsed.openSessions
          .map(stringValue)
          .filter((value): value is string => Boolean(value))
          .slice(0, MAX_RESTORED_TABS)
      : [];

    const localWorkspaces: PersistedLocalWorkspace[] = Array.isArray(parsed.localWorkspaces)
      ? parsed.localWorkspaces
          .flatMap((value) => {
            if (!value || typeof value !== 'object') return [];
            const item = value as Record<string, unknown>;
            const id = stringValue(item.id);
            const profileId = stringValue(item.profileId);
            if (!id || !profileId) return [];

            const projectId = stringValue(item.projectId);
            return [{ id, profileId, ...(projectId ? { projectId } : {}) }];
          })
          .slice(0, MAX_RESTORED_TABS)
      : [];

    return {
      version: 1,
      openSessions,
      localWorkspaces,
      active: parseActive(parsed.active),
      layout: {
        leftMode,
        leftWidth: clampLeftWidth(layout.leftWidth),
        leftCollapsed: layout.leftCollapsed === true,
        serverOpsTab,
      },
    };
  } catch {
    return null;
  }
}

export function saveWorkspaceSnapshot(input: SaveWorkspaceInput): void {
  const snapshot: WorkspaceSnapshotV1 = {
    version: 1,
    openSessions: [...new Set(input.openSessions)].slice(0, MAX_RESTORED_TABS),
    localWorkspaces: input.localWorkspaces.slice(0, MAX_RESTORED_TABS).map((workspace) => ({
      id: workspace.id,
      profileId: workspace.profile.id,
      ...(workspace.projectId ? { projectId: workspace.projectId } : {}),
      // cliProfileId/cliName sengaja TIDAK disimpan. Restore harus membuka
      // shell/project, bukan auto-run OMP/Codex/Claude.
    })),
    active: input.active,
    layout: {
      leftMode: input.leftMode,
      leftWidth: clampLeftWidth(input.leftWidth),
      leftCollapsed: input.leftCollapsed,
      serverOpsTab: input.serverOpsTab,
    },
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Convenience only. Kegagalan storage tidak boleh mengganggu terminal.
  }
}

function fallbackProfile(
  project: LocalProjectSummary | undefined,
  profiles: LocalTerminalProfile[],
): LocalTerminalProfile | undefined {
  if (project?.defaultTerminalProfileId) {
    const preferred = profiles.find((profile) => profile.id === project.defaultTerminalProfileId);
    if (preferred) return preferred;
  }

  return (
    profiles.find((profile) => profile.id === 'powershell7') ??
    profiles.find((profile) => profile.id === 'windows-powershell') ??
    profiles.find((profile) => profile.id === 'cmd') ??
    profiles[0]
  );
}

export function restoreLocalWorkspaces(
  snapshot: WorkspaceSnapshotV1,
  profiles: LocalTerminalProfile[],
  projects: LocalProjectSummary[],
): LocalTerminalWorkspace[] {
  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
  const projectMap = new Map(projects.map((project) => [project.id, project]));
  const seen = new Set<string>();
  const result: LocalTerminalWorkspace[] = [];

  for (const saved of snapshot.localWorkspaces) {
    if (seen.has(saved.id)) continue;

    const project = saved.projectId ? projectMap.get(saved.projectId) : undefined;
    if (saved.projectId && (!project || !project.pathExists)) continue;

    const profile = profileMap.get(saved.profileId) ?? fallbackProfile(project, profiles);
    if (!profile) continue;

    seen.add(saved.id);
    result.push({
      id: saved.id,
      profile,
      ...(project
        ? {
            projectId: project.id,
            projectName: project.name,
            cwd: project.path,
          }
        : {}),
      createdAt: Date.now(),
    });
  }

  return result;
}

export function restoreOpenSessions(
  snapshot: WorkspaceSnapshotV1,
  sessions: SessionConfig[],
): string[] {
  const validIds = new Set(sessions.map((session) => session.id));
  return snapshot.openSessions.filter(
    (id, index, all) => validIds.has(id) && all.indexOf(id) === index,
  );
}

export function resolveRestoredActive(
  requested: WorkspaceActiveTarget,
  openSessions: string[],
  localWorkspaces: LocalTerminalWorkspace[],
): WorkspaceActiveTarget {
  if (requested.kind === 'remote' && openSessions.includes(requested.sessionId)) {
    return requested;
  }

  if (
    requested.kind === 'local' &&
    localWorkspaces.some((workspace) => workspace.id === requested.workspaceId)
  ) {
    return requested;
  }

  return { kind: 'dashboard' };
}
