import { useEffect, useMemo, useState, type FormEvent } from 'react';

import type {
  LocalCliAvailability,
  LocalCliLauncher,
  LocalProjectCreateInput,
  LocalProjectSummary,
  LocalTerminalProfile,
} from '../shared/types';
import { useI18n } from '../i18n';

interface LocalTerminalPanelProps {
  profiles: LocalTerminalProfile[];
  loading: boolean;
  onOpen: (profile: LocalTerminalProfile) => void;
  onOpenProject: (
    project: LocalProjectSummary,
    profile: LocalTerminalProfile,
    launcher?: LocalCliLauncher,
  ) => void;
  onRefresh: () => void | Promise<void>;
}

interface ProjectDraft {
  id?: string;
  name: string;
  path: string;
  defaultTerminalProfileId: string;
  preferredCli: '' | LocalCliLauncher;
}

const EMPTY_DRAFT: ProjectDraft = {
  name: '',
  path: '',
  defaultTerminalProfileId: '',
  preferredCli: '',
};

const LAUNCHER_IDS: LocalCliLauncher[] = ['omp', 'codex', 'claude'];

function iconFor(profile: LocalTerminalProfile): string {
  if (profile.kind === 'wsl') return '⌁';
  if (profile.id === 'cmd') return 'C:\\';
  return '>_';
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function resolveProjectShell(
  project: LocalProjectSummary,
  profiles: LocalTerminalProfile[],
): LocalTerminalProfile | undefined {
  if (project.defaultTerminalProfileId) {
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

export function LocalTerminalPanel({
  profiles,
  loading,
  onOpen,
  onOpenProject,
  onRefresh,
}: LocalTerminalPanelProps) {
  const { t } = useI18n();
  const [projects, setProjects] = useState<LocalProjectSummary[]>([]);
  const [launchers, setLaunchers] = useState<LocalCliAvailability[]>([]);
  const [projectLoading, setProjectLoading] = useState(true);
  const [draft, setDraft] = useState<ProjectDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const launcherMap = useMemo(
    () => new Map(launchers.map((launcher) => [launcher.id, launcher])),
    [launchers],
  );

  const refreshWorkspace = async () => {
    setProjectLoading(true);
    try {
      const [savedProjects, cli] = await Promise.all([
        window.ssh.localProjects.list(),
        window.ssh.local.listLaunchers(),
      ]);
      setProjects(savedProjects);
      setLaunchers(cli);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setProjectLoading(false);
    }
  };

  useEffect(() => {
    void refreshWorkspace();
  }, []);

  const handleRefresh = async () => {
    await onRefresh();
    await refreshWorkspace();
  };

  const browseFolder = async () => {
    const path = await window.ssh.dialog.pickProjectFolder();
    if (!path) return;
    setDraft((current) => ({
      ...(current ?? EMPTY_DRAFT),
      path,
      name: current?.name || basename(path),
    }));
  };

  const editProject = (project: LocalProjectSummary) => {
    setError(null);
    setDraft({
      id: project.id,
      name: project.name,
      path: project.path,
      defaultTerminalProfileId: project.defaultTerminalProfileId ?? '',
      preferredCli: project.preferredCli ?? '',
    });
  };

  const saveProject = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft) return;

    setSaving(true);
    setError(null);
    try {
      if (draft.id) {
        await window.ssh.localProjects.update(draft.id, {
          name: draft.name,
          path: draft.path,
          defaultTerminalProfileId: draft.defaultTerminalProfileId || null,
          preferredCli: draft.preferredCli || null,
        });
      } else {
        const input: LocalProjectCreateInput = {
          name: draft.name,
          path: draft.path,
          defaultTerminalProfileId: draft.defaultTerminalProfileId || undefined,
          preferredCli: draft.preferredCli || undefined,
        };
        await window.ssh.localProjects.create(input);
      }

      setDraft(null);
      await refreshWorkspace();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const removeProject = async (project: LocalProjectSummary) => {
    if (!window.confirm(t('local.removeConfirm', { name: project.name }))) return;
    try {
      await window.ssh.localProjects.remove(project.id);
      await refreshWorkspace();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const openFolder = async (project: LocalProjectSummary) => {
    try {
      await window.ssh.localProjects.openFolder(project.id);
      await refreshWorkspace();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const openProject = (project: LocalProjectSummary, launcher?: LocalCliLauncher) => {
    const profile = resolveProjectShell(project, profiles);
    if (!profile) {
      setError(t('local.noShellForProject'));
      return;
    }
    onOpenProject(project, profile, launcher);
  };

  return (
    <section className="aspro-local-panel">
      <div className="aspro-local-title">
        <div>
          <span>{t('local.title')}</span>
          <small>{t('local.subtitle')}</small>
        </div>
        <button onClick={() => void handleRefresh()} title={t('local.refresh')}>⟳</button>
      </div>

      {error ? <div className="aspro-local-error">{error}</div> : null}

      <div className="aspro-local-section-heading">
        <span>{t('local.projects')}</span>
        <button
          className="aspro-local-add"
          onClick={() => {
            setError(null);
            setDraft({ ...EMPTY_DRAFT });
          }}
        >
          + {t('local.addProject')}
        </button>
      </div>

      {draft ? (
        <form className="aspro-local-project-form" onSubmit={saveProject}>
          <label>
            <span>{t('local.projectName')}</span>
            <input
              autoFocus
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              placeholder={t('local.projectNamePlaceholder')}
            />
          </label>

          <label>
            <span>{t('local.projectPath')}</span>
            <div className="aspro-local-path-picker">
              <input value={draft.path} readOnly placeholder="E:\Project\MyApp" />
              <button type="button" onClick={() => void browseFolder()}>
                {t('local.browse')}
              </button>
            </div>
          </label>

          <label>
            <span>{t('local.defaultShell')}</span>
            <select
              value={draft.defaultTerminalProfileId}
              onChange={(event) =>
                setDraft({ ...draft, defaultTerminalProfileId: event.target.value })
              }
            >
              <option value="">{t('local.autoShell')}</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.kind === 'wsl' ? `WSL · ${profile.name}` : profile.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>{t('local.preferredCli')}</span>
            <select
              value={draft.preferredCli}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  preferredCli: event.target.value as '' | LocalCliLauncher,
                })
              }
            >
              <option value="">{t('local.noPreferredCli')}</option>
              <option value="omp">OMP</option>
              <option value="codex">Codex</option>
              <option value="claude">Claude</option>
            </select>
          </label>

          <div className="aspro-local-form-actions">
            <button type="button" onClick={() => setDraft(null)} disabled={saving}>
              {t('local.cancel')}
            </button>
            <button type="submit" className="primary" disabled={saving || !draft.name || !draft.path}>
              {saving ? t('local.saving') : t('local.saveProject')}
            </button>
          </div>
        </form>
      ) : null}

      <div className="aspro-local-projects">
        {projectLoading ? (
          <div className="aspro-local-empty">{t('local.loadingProjects')}</div>
        ) : projects.length === 0 ? (
          <div className="aspro-local-empty">{t('local.noProjects')}</div>
        ) : (
          projects.map((project) => {
            const profile = resolveProjectShell(project, profiles);
            return (
              <article
                key={project.id}
                className={`aspro-local-project-card ${project.pathExists ? '' : 'missing'}`}
              >
                <div className="aspro-local-project-head">
                  <div className="min-w-0">
                    <strong title={project.name}>{project.name}</strong>
                    <small title={project.path}>{project.path}</small>
                  </div>
                  {!project.pathExists ? (
                    <span className="aspro-local-missing-badge">{t('local.missing')}</span>
                  ) : null}
                </div>

                <div className="aspro-local-project-actions">
                  <button
                    disabled={!project.pathExists || !profile}
                    onClick={() => openProject(project)}
                  >
                    {t('local.terminal')}
                  </button>

                  {LAUNCHER_IDS.map((launcherId) => {
                    const launcher = launcherMap.get(launcherId);
                    const available = Boolean(launcher?.available);
                    return (
                      <button
                        key={launcherId}
                        className={project.preferredCli === launcherId ? 'preferred' : ''}
                        disabled={!project.pathExists || !profile || !available}
                        title={available ? launcher?.command : t('local.cliUnavailable')}
                        onClick={() => openProject(project, launcherId)}
                      >
                        {launcher?.label ?? launcherId}
                      </button>
                    );
                  })}
                </div>

                <div className="aspro-local-project-tools">
                  <span>
                    {profile
                      ? `${t('local.shell')}: ${
                          profile.kind === 'wsl' ? `WSL · ${profile.name}` : profile.name
                        }`
                      : t('local.noShellForProject')}
                  </span>
                  <div>
                    <button onClick={() => editProject(project)}>{t('local.edit')}</button>
                    <button
                      onClick={() => void openFolder(project)}
                      disabled={!project.pathExists}
                    >
                      {t('local.openFolder')}
                    </button>
                    <button
                      className="danger"
                      onClick={() => void removeProject(project)}
                    >
                      {t('local.remove')}
                    </button>
                  </div>
                </div>
              </article>
            );
          })
        )}
      </div>

      <div className="aspro-local-section-heading shells">
        <span>{t('local.shells')}</span>
      </div>

      {loading ? (
        <div className="aspro-local-empty">{t('local.detecting')}</div>
      ) : profiles.length === 0 ? (
        <div className="aspro-local-empty">{t('local.none')}</div>
      ) : (
        <div className="aspro-local-list">
          {profiles.map((profile) => (
            <button
              key={profile.id}
              className="aspro-local-row"
              onClick={() => onOpen(profile)}
            >
              <span className={`aspro-local-icon ${profile.kind}`}>{iconFor(profile)}</span>
              <span className="min-w-0 flex-1 text-left">
                <strong>{profile.kind === 'wsl' ? `WSL · ${profile.name}` : profile.name}</strong>
                <small>{profile.detail}</small>
              </span>
              <span className="aspro-local-open">＋</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
