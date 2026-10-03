import { useEffect, useMemo, useState, type FormEvent } from 'react';

import type {
  LocalCliAvailability,
  LocalCliCreateInput,
  LocalCliProfile,
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
    cli?: LocalCliProfile,
  ) => void;
  onRefresh: () => void | Promise<void>;
}

interface ProjectDraft {
  id?: string;
  name: string;
  path: string;
  defaultTerminalProfileId: string;
  preferredCliProfileId: string;
}

interface CliDraft {
  id?: string;
  source?: LocalCliProfile['source'];
  name: string;
  command: string;
  argsText: string;
  enabled: boolean;
}

const EMPTY_PROJECT_DRAFT: ProjectDraft = {
  name: '',
  path: '',
  defaultTerminalProfileId: '',
  preferredCliProfileId: '',
};

const EMPTY_CLI_DRAFT: CliDraft = {
  name: '',
  command: '',
  argsText: '',
  enabled: true,
};

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

function parseArgs(value: string): string[] {
  return value
    .trim()
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
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
  const [cliProfiles, setCliProfiles] = useState<LocalCliAvailability[]>([]);
  const [projectLoading, setProjectLoading] = useState(true);
  const [projectDraft, setProjectDraft] = useState<ProjectDraft | null>(null);
  const [cliDraft, setCliDraft] = useState<CliDraft | null>(null);
  const [cliSelection, setCliSelection] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cliMap = useMemo(
    () => new Map(cliProfiles.map((profile) => [profile.id, profile])),
    [cliProfiles],
  );

  const refreshWorkspace = async () => {
    setProjectLoading(true);
    try {
      const [savedProjects, cli] = await Promise.all([
        window.ssh.localProjects.list(),
        window.ssh.localCli.list(),
      ]);
      setProjects(savedProjects);
      setCliProfiles(cli);
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
    setProjectDraft((current) => ({
      ...(current ?? EMPTY_PROJECT_DRAFT),
      path,
      name: current?.name || basename(path),
    }));
  };

  const editProject = (project: LocalProjectSummary) => {
    setError(null);
    setProjectDraft({
      id: project.id,
      name: project.name,
      path: project.path,
      defaultTerminalProfileId: project.defaultTerminalProfileId ?? '',
      preferredCliProfileId: project.preferredCliProfileId ?? '',
    });
  };

  const saveProject = async (event: FormEvent) => {
    event.preventDefault();
    if (!projectDraft) return;

    setSaving(true);
    setError(null);
    try {
      if (projectDraft.id) {
        await window.ssh.localProjects.update(projectDraft.id, {
          name: projectDraft.name,
          path: projectDraft.path,
          defaultTerminalProfileId: projectDraft.defaultTerminalProfileId || null,
          preferredCliProfileId: projectDraft.preferredCliProfileId || null,
        });
      } else {
        const input: LocalProjectCreateInput = {
          name: projectDraft.name,
          path: projectDraft.path,
          defaultTerminalProfileId: projectDraft.defaultTerminalProfileId || undefined,
          preferredCliProfileId: projectDraft.preferredCliProfileId || undefined,
        };
        await window.ssh.localProjects.create(input);
      }

      setProjectDraft(null);
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

  const openProject = (project: LocalProjectSummary, cli?: LocalCliProfile) => {
    const profile = resolveProjectShell(project, profiles);
    if (!profile) {
      setError(t('local.noShellForProject'));
      return;
    }
    onOpenProject(project, profile, cli);
  };

  const editCli = (cli: LocalCliProfile) => {
    setError(null);
    setCliDraft({
      id: cli.id,
      source: cli.source,
      name: cli.name,
      command: cli.command,
      argsText: cli.args.join(' '),
      enabled: cli.enabled,
    });
  };

  const saveCli = async (event: FormEvent) => {
    event.preventDefault();
    if (!cliDraft) return;

    setSaving(true);
    setError(null);
    try {
      const input: LocalCliCreateInput = {
        name: cliDraft.name,
        command: cliDraft.command,
        args: parseArgs(cliDraft.argsText),
        enabled: cliDraft.enabled,
      };

      if (cliDraft.id) {
        await window.ssh.localCli.update(cliDraft.id, input);
      } else {
        await window.ssh.localCli.create(input);
      }

      setCliDraft(null);
      await refreshWorkspace();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const toggleCli = async (cli: LocalCliProfile) => {
    try {
      await window.ssh.localCli.update(cli.id, { enabled: !cli.enabled });
      await refreshWorkspace();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const removeCli = async (cli: LocalCliProfile) => {
    if (!window.confirm(t('local.deleteCliConfirm', { name: cli.name }))) return;
    try {
      await window.ssh.localCli.remove(cli.id);
      await refreshWorkspace();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const statusLabel = (cli: LocalCliAvailability) => {
    if (cli.status === 'disabled') return t('local.cliDisabled');
    if (cli.status === 'available') return t('local.cliAvailable');
    return t('local.cliNotFound');
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
            setProjectDraft({ ...EMPTY_PROJECT_DRAFT });
          }}
        >
          + {t('local.addProject')}
        </button>
      </div>

      {projectDraft ? (
        <form className="aspro-local-project-form" onSubmit={saveProject}>
          <label>
            <span>{t('local.projectName')}</span>
            <input
              autoFocus
              value={projectDraft.name}
              onChange={(event) => setProjectDraft({ ...projectDraft, name: event.target.value })}
              placeholder={t('local.projectNamePlaceholder')}
            />
          </label>

          <label>
            <span>{t('local.projectPath')}</span>
            <div className="aspro-local-path-picker">
              <input value={projectDraft.path} readOnly placeholder="E:\Project\MyApp" />
              <button type="button" onClick={() => void browseFolder()}>
                {t('local.browse')}
              </button>
            </div>
          </label>

          <label>
            <span>{t('local.defaultShell')}</span>
            <select
              value={projectDraft.defaultTerminalProfileId}
              onChange={(event) =>
                setProjectDraft({ ...projectDraft, defaultTerminalProfileId: event.target.value })
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
              value={projectDraft.preferredCliProfileId}
              onChange={(event) =>
                setProjectDraft({ ...projectDraft, preferredCliProfileId: event.target.value })
              }
            >
              <option value="">{t('local.noPreferredCli')}</option>
              {cliProfiles.map((cli) => (
                <option key={cli.id} value={cli.id}>
                  {cli.name} · {statusLabel(cli)}
                </option>
              ))}
            </select>
          </label>

          <div className="aspro-local-form-actions">
            <button type="button" onClick={() => setProjectDraft(null)} disabled={saving}>
              {t('local.cancel')}
            </button>
            <button
              type="submit"
              className="primary"
              disabled={saving || !projectDraft.name || !projectDraft.path}
            >
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
            const selectedId =
              cliSelection[project.id] ??
              project.preferredCliProfileId ??
              cliProfiles.find((cli) => cli.enabled && cli.available)?.id ??
              cliProfiles.find((cli) => cli.enabled)?.id ??
              '';
            const selectedCli = selectedId ? cliMap.get(selectedId) : undefined;

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

                <div className="aspro-local-project-actions registry">
                  <button
                    disabled={!project.pathExists || !profile}
                    onClick={() => openProject(project)}
                  >
                    {t('local.terminal')}
                  </button>
                  <select
                    value={selectedId}
                    onChange={(event) =>
                      setCliSelection((current) => ({
                        ...current,
                        [project.id]: event.target.value,
                      }))
                    }
                    title={t('local.cliSelect')}
                  >
                    <option value="">{t('local.cliSelect')}</option>
                    {cliProfiles.map((cli) => (
                      <option key={cli.id} value={cli.id} disabled={!cli.enabled}>
                        {cli.name} · {statusLabel(cli)}
                      </option>
                    ))}
                  </select>
                  <button
                    className={
                      selectedCli && project.preferredCliProfileId === selectedCli.id
                        ? 'preferred'
                        : ''
                    }
                    disabled={
                      !project.pathExists ||
                      !profile ||
                      !selectedCli ||
                      !selectedCli.enabled ||
                      !selectedCli.available
                    }
                    title={
                      selectedCli?.available
                        ? selectedCli.command
                        : t('local.cliUnavailable')
                    }
                    onClick={() => selectedCli && openProject(project, selectedCli)}
                  >
                    {t('local.run')}
                  </button>
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

      <div className="aspro-local-section-heading cli">
        <span>{t('local.cliTools')}</span>
        <button
          className="aspro-local-add"
          onClick={() => {
            setError(null);
            setCliDraft({ ...EMPTY_CLI_DRAFT });
          }}
        >
          + {t('local.addCli')}
        </button>
      </div>

      {cliDraft ? (
        <form className="aspro-local-project-form aspro-local-cli-form" onSubmit={saveCli}>
          <label>
            <span>{t('local.cliName')}</span>
            <input
              autoFocus
              value={cliDraft.name}
              onChange={(event) => setCliDraft({ ...cliDraft, name: event.target.value })}
              placeholder={t('local.cliNamePlaceholder')}
            />
          </label>
          <label>
            <span>{t('local.cliCommand')}</span>
            <input
              value={cliDraft.command}
              onChange={(event) => setCliDraft({ ...cliDraft, command: event.target.value })}
              placeholder={t('local.cliCommandPlaceholder')}
            />
            <small>{t('local.cliCommandHelp')}</small>
          </label>
          <label>
            <span>{t('local.cliArgs')}</span>
            <input
              value={cliDraft.argsText}
              onChange={(event) => setCliDraft({ ...cliDraft, argsText: event.target.value })}
              placeholder={t('local.cliArgsPlaceholder')}
            />
          </label>
          <label className="aspro-local-check">
            <input
              type="checkbox"
              checked={cliDraft.enabled}
              onChange={(event) => setCliDraft({ ...cliDraft, enabled: event.target.checked })}
            />
            <span>{t('local.cliEnabled')}</span>
          </label>
          <div className="aspro-local-form-actions">
            <button type="button" onClick={() => setCliDraft(null)} disabled={saving}>
              {t('local.cancel')}
            </button>
            <button
              type="submit"
              className="primary"
              disabled={saving || !cliDraft.name || !cliDraft.command}
            >
              {saving ? t('local.saving') : t('local.saveCli')}
            </button>
          </div>
        </form>
      ) : null}

      <div className="aspro-local-cli-list">
        {cliProfiles.map((cli) => (
          <div key={cli.id} className="aspro-local-cli-row">
            <div className="min-w-0">
              <strong>{cli.name}</strong>
              <small title={[cli.command, ...cli.args].join(' ')}>
                {[cli.command, ...cli.args].join(' ')}
              </small>
            </div>
            <span className={`aspro-local-cli-status ${cli.status}`}>
              {statusLabel(cli)}
            </span>
            <div className="aspro-local-cli-tools">
              <button onClick={() => editCli(cli)}>{t('local.edit')}</button>
              <button onClick={() => void toggleCli(cli)}>
                {cli.enabled ? t('local.disableCli') : t('local.enableCli')}
              </button>
              {cli.source === 'custom' ? (
                <button className="danger" onClick={() => void removeCli(cli)}>
                  {t('local.deleteCli')}
                </button>
              ) : (
                <span title={t('local.cliBuiltin')}>●</span>
              )}
            </div>
          </div>
        ))}
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
