import { useEffect, useState, type FormEvent } from 'react';
import type { ProjectProfile, DeployTemplate } from '../shared/types';
import { useI18n } from '../i18n';
import { DeployHistoryModal } from './DeployHistoryModal';
import { EnvFileEditor } from './EnvFileEditor';

/**
 * Panel Project — fondasi DevOps: menandai satu working directory di server
 * yang sedang aktif. Belum menjalankan apa-apa sendiri; fitur berikutnya
 * (log viewer, service manager, jalankan deploy template) nempel ke sini.
 */

interface ProjectsPanelProps {
  sessionId: string;
  onOpenLog: (sessionId: string, path: string) => void;
  onOpenService: (unit: string) => void;
  onOpenGit: (projectId: string) => void;
  onOpenDeploy: (project: ProjectProfile, templateName: string) => void;
  onOpenRollback: (project: ProjectProfile, templateName: string, entryId: string) => void;
}

function basename(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path;
}

type FormState = { open: false } | { open: true; editing: ProjectProfile | null };

export function ProjectsPanel({
  sessionId,
  onOpenLog,
  onOpenService,
  onOpenGit,
  onOpenDeploy,
  onOpenRollback,
}: ProjectsPanelProps) {
  const { t } = useI18n();
  const [projectList, setProjectList] = useState<ProjectProfile[]>([]);
  const [templates, setTemplates] = useState<DeployTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState>({ open: false });
  const [pendingDelete, setPendingDelete] = useState<ProjectProfile | null>(null);
  const [pendingDeploy, setPendingDeploy] = useState<ProjectProfile | null>(null);
  const [historyProject, setHistoryProject] = useState<ProjectProfile | null>(null);
  const [envProject, setEnvProject] = useState<ProjectProfile | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      setProjectList(await window.ssh.projects.list(sessionId));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    void window.ssh.templates.list().then(setTemplates);
  }, [sessionId]);

  // ProjectsPanel tetap ter-mount selama session aktif (cuma disembunyikan
  // lewat CSS saat pindah tab kiri) — tanpa ini, template baru yang dibuat
  // di Settings tidak pernah terlihat sampai session di-reconnect, karena
  // daftar template di atas cuma diambil sekali saat mount.
  useEffect(() => {
    if (form.open) void window.ssh.templates.list().then(setTemplates);
  }, [form.open]);

  const templateName = (id?: string) => templates.find((tpl) => tpl.id === id)?.name;

  return (
    <section className="aspro-local-panel">
      <div className="aspro-local-title">
        <div>
          <span>{t('nav.projects')}</span>
          <small>{t('project.subtitle', { count: projectList.length })}</small>
        </div>
        <button onClick={() => setForm({ open: true, editing: null })} title={t('project.add')}>
          ＋
        </button>
      </div>

      {loading ? (
        <div className="aspro-local-empty">{t('sftp.loading')}</div>
      ) : projectList.length === 0 ? (
        <div className="aspro-local-empty">
          <strong className="mb-1 block text-dim">{t('project.empty')}</strong>
          <span>{t('project.emptyDetail')}</span>
        </div>
      ) : (
        <div className="aspro-local-list">
          {projectList.map((project) => (
            <div key={project.id}>
              <div className="aspro-local-row group">
                <span className="aspro-local-icon">▣</span>
                <button
                  className="min-w-0 flex-1 text-left"
                  onClick={() => setForm({ open: true, editing: project })}
                >
                  <strong>{project.name}</strong>
                  <small className="font-mono">{project.path}</small>
                  {project.deployTemplateId && templateName(project.deployTemplateId) && (
                    <small>⇪ {templateName(project.deployTemplateId)}</small>
                  )}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setPendingDelete(project);
                  }}
                  title={t('project.delete')}
                  className="shrink-0 rounded px-1.5 py-1 text-faint opacity-0 hover:bg-line hover:text-fg focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-azure group-hover:opacity-100"
                >
                  ✕
                </button>
              </div>

              <div className="mb-1.5 mt-1 flex flex-wrap gap-1.5 pl-[39px]">
                <button
                  onClick={() => onOpenGit(project.id)}
                  title={t('project.gitStatus')}
                  className="rounded border border-line px-2 py-1 font-mono text-[10px] text-dim hover:border-azure hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
                >
                  ⎇ {t('project.gitStatus')}
                </button>
                <button
                  onClick={() => setEnvProject(project)}
                  title={t('envfile.button')}
                  className="rounded border border-line px-2 py-1 font-mono text-[10px] text-dim hover:border-azure hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
                >
                  🔑 {t('envfile.button')}
                </button>
                {project.deployTemplateId && templateName(project.deployTemplateId) && (
                  <button
                    onClick={() => setPendingDeploy(project)}
                    title={t('deploy.trigger', { template: templateName(project.deployTemplateId) ?? '' })}
                    className="rounded border border-line px-2 py-1 font-mono text-[10px] text-dim hover:border-azure hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
                  >
                    ▶ {t('deploy.deployChip')}
                  </button>
                )}
                {project.deployTemplateId && templateName(project.deployTemplateId) && (
                  <button
                    onClick={() => setHistoryProject(project)}
                    title={t('deploy.historyButton')}
                    className="rounded border border-line px-2 py-1 font-mono text-[10px] text-dim hover:border-azure hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
                  >
                    🕘 {t('deploy.historyButton')}
                  </button>
                )}
                {project.logPaths.map((logPath) => (
                  <button
                    key={`log-${logPath}`}
                    onClick={() => onOpenLog(project.sessionId, logPath)}
                    title={logPath}
                    className="rounded border border-line px-2 py-1 font-mono text-[10px] text-dim hover:border-azure hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
                  >
                    ▶ {basename(logPath)}
                  </button>
                ))}
                {project.serviceNames.map((unit) => (
                  <button
                    key={`svc-${unit}`}
                    onClick={() => onOpenService(unit)}
                    title={unit}
                    className="rounded border border-line px-2 py-1 font-mono text-[10px] text-dim hover:border-azure hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
                  >
                    ⏻ {unit}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {form.open && (
        <ProjectFormDialog
          sessionId={sessionId}
          existing={form.editing}
          templates={templates}
          onSave={async () => {
            setForm({ open: false });
            await refresh();
          }}
          onCancel={() => setForm({ open: false })}
        />
      )}

      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
          <div className="w-full max-w-sm rounded-lg border border-line bg-raised p-6">
            <h2 className="break-all text-sm font-semibold text-fg">
              {t('project.deleteConfirmTitle', { name: pendingDelete.name })}
            </h2>
            <p className="mt-2 text-xs text-muted">{t('project.deleteConfirmDesc')}</p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => setPendingDelete(null)}
                className="rounded px-4 py-2 text-sm text-dim hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
              >
                {t('project.cancel')}
              </button>
              <button
                onClick={async () => {
                  await window.ssh.projects.remove(pendingDelete.id);
                  setPendingDelete(null);
                  await refresh();
                }}
                className="rounded bg-coral px-4 py-2 text-sm font-medium text-abyss hover:bg-coral-bright focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
              >
                {t('project.delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingDeploy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
          <div className="w-full max-w-sm rounded-lg border border-line bg-raised p-6">
            <h2 className="break-all text-sm font-semibold text-fg">
              {t('deploy.confirmTitle', { name: pendingDeploy.name })}
            </h2>
            <p className="mt-2 text-xs text-muted">
              {t('deploy.confirmDesc', {
                template: templateName(pendingDeploy.deployTemplateId) ?? '',
                count:
                  templates.find((tpl) => tpl.id === pendingDeploy.deployTemplateId)?.steps.length ?? 0,
              })}
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => setPendingDeploy(null)}
                className="rounded px-4 py-2 text-sm text-dim hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
              >
                {t('project.cancel')}
              </button>
              <button
                onClick={() => {
                  const template = templateName(pendingDeploy.deployTemplateId) ?? '';
                  onOpenDeploy(pendingDeploy, template);
                  setPendingDeploy(null);
                }}
                className="aspro-button aspro-button-primary"
              >
                {t('deploy.confirmRun')}
              </button>
            </div>
          </div>
        </div>
      )}

      {historyProject && (
        <DeployHistoryModal
          project={historyProject}
          templateName={templateName(historyProject.deployTemplateId) ?? ''}
          onRollback={(entryId) =>
            onOpenRollback(historyProject, templateName(historyProject.deployTemplateId) ?? '', entryId)
          }
          onClose={() => setHistoryProject(null)}
        />
      )}

      {envProject && (
        <EnvFileEditor
          sessionId={envProject.sessionId}
          project={envProject}
          onClose={() => setEnvProject(null)}
        />
      )}
    </section>
  );
}

function ProjectFormDialog({
  sessionId,
  existing,
  templates,
  onSave,
  onCancel,
}: {
  sessionId: string;
  existing: ProjectProfile | null;
  templates: DeployTemplate[];
  onSave: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(existing?.name ?? '');
  const [path, setPath] = useState(existing?.path ?? '');
  const [deployTemplateId, setDeployTemplateId] = useState(existing?.deployTemplateId ?? '');
  const [env, setEnv] = useState<Array<{ key: string; value: string }>>(
    existing ? Object.entries(existing.env).map(([key, value]) => ({ key, value })) : [],
  );
  const [logPaths, setLogPaths] = useState<string[]>(existing?.logPaths ?? []);
  const [serviceNames, setServiceNames] = useState<string[]>(existing?.serviceNames ?? []);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [detectError, setDetectError] = useState<string | null>(null);

  const detectLogs = async () => {
    if (!path.trim()) {
      setDetectError(t('project.path'));
      return;
    }
    setDetecting(true);
    setDetectError(null);
    try {
      const found = await window.ssh.projects.detectLogs(sessionId, path.trim());
      if (found.length === 0) {
        setDetectError(t('project.detectLogsEmpty'));
        return;
      }
      setLogPaths((prev) => [...prev, ...found.filter((p) => !prev.includes(p))]);
    } catch (err) {
      setDetectError((err as Error).message);
    } finally {
      setDetecting(false);
    }
  };

  const updateEnvRow = (index: number, patch: Partial<{ key: string; value: string }>) => {
    setEnv((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const removeEnvRow = (index: number) => {
    setEnv((prev) => prev.filter((_, i) => i !== index));
  };

  const updateLogPath = (index: number, value: string) => {
    setLogPaths((prev) => prev.map((p, i) => (i === index ? value : p)));
  };

  const removeLogPath = (index: number) => {
    setLogPaths((prev) => prev.filter((_, i) => i !== index));
  };

  const updateServiceName = (index: number, value: string) => {
    setServiceNames((prev) => prev.map((n, i) => (i === index ? value : n)));
  };

  const removeServiceName = (index: number) => {
    setServiceNames((prev) => prev.filter((_, i) => i !== index));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !path.trim()) {
      setError(t('project.name') + ' / ' + t('project.path'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const envRecord = Object.fromEntries(
        env.filter((row) => row.key.trim()).map((row) => [row.key.trim(), row.value]),
      );
      const input = {
        name: name.trim(),
        path: path.trim(),
        env: envRecord,
        logPaths: logPaths.map((p) => p.trim()).filter(Boolean),
        serviceNames: serviceNames.map((n) => n.trim()).filter(Boolean),
        deployTemplateId: deployTemplateId || undefined,
      };
      if (existing) await window.ssh.projects.update(existing.id, input);
      else await window.ssh.projects.create(sessionId, input);
      onSave();
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <form
        onSubmit={(e) => void submit(e)}
        className="flex max-h-[85vh] w-full max-w-md flex-col rounded-lg border border-line bg-raised p-6"
      >
        <h2 className="shrink-0 text-sm font-semibold text-fg">
          {existing ? t('project.edit') : t('project.add')}
        </h2>

        <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          <div>
            <span className="mb-1.5 block text-xs text-muted">{t('project.name')}</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('project.namePlaceholder')}
              className="aspro-input w-full px-3 py-2 text-sm text-fg placeholder-faint focus:border-azure focus:outline-none"
            />
          </div>

          <div>
            <span className="mb-1.5 block text-xs text-muted">{t('project.path')}</span>
            <input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder={t('project.pathPlaceholder')}
              spellCheck={false}
              className="aspro-input w-full px-3 py-2 font-mono text-sm text-fg placeholder-faint focus:border-azure focus:outline-none"
            />
          </div>

          <div>
            <span className="mb-1.5 block text-xs text-muted">{t('project.deployTemplate')}</span>
            <select
              value={deployTemplateId}
              onChange={(e) => setDeployTemplateId(e.target.value)}
              className="aspro-input w-full px-3 py-2 text-sm text-fg focus:border-azure focus:outline-none"
            >
              <option value="">{t('project.deployTemplateNone')}</option>
              {templates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <span className="mb-1.5 block text-xs text-muted">{t('project.env')}</span>
            <div className="space-y-2">
              {env.map((row, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    value={row.key}
                    onChange={(e) => updateEnvRow(index, { key: e.target.value })}
                    placeholder={t('project.envKeyPlaceholder')}
                    spellCheck={false}
                    className="aspro-input w-1/2 px-2 py-1.5 font-mono text-xs text-fg placeholder-faint focus:border-azure focus:outline-none"
                  />
                  <input
                    value={row.value}
                    onChange={(e) => updateEnvRow(index, { value: e.target.value })}
                    placeholder={t('project.envValuePlaceholder')}
                    spellCheck={false}
                    className="aspro-input w-1/2 px-2 py-1.5 font-mono text-xs text-fg placeholder-faint focus:border-azure focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => removeEnvRow(index)}
                    className="shrink-0 rounded px-1.5 py-1 text-faint hover:bg-line hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setEnv((prev) => [...prev, { key: '', value: '' }])}
                className="text-xs text-azure hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
              >
                {t('project.envAdd')}
              </button>
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="block text-xs text-muted">{t('project.logPaths')}</span>
              <button
                type="button"
                onClick={() => void detectLogs()}
                disabled={detecting}
                className="text-[11px] text-azure hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-azure disabled:cursor-not-allowed disabled:opacity-40"
              >
                {detecting ? t('project.detecting') : `⌕ ${t('project.detectLogs')}`}
              </button>
            </div>
            {detectError && <p className="mb-1.5 text-[11px] text-coral">{detectError}</p>}
            <div className="space-y-2">
              {logPaths.map((logPath, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    value={logPath}
                    onChange={(e) => updateLogPath(index, e.target.value)}
                    placeholder={t('project.logPathPlaceholder')}
                    spellCheck={false}
                    className="aspro-input w-full px-2 py-1.5 font-mono text-xs text-fg placeholder-faint focus:border-azure focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => removeLogPath(index)}
                    className="shrink-0 rounded px-1.5 py-1 text-faint hover:bg-line hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setLogPaths((prev) => [...prev, ''])}
                className="text-xs text-azure hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
              >
                {t('project.logPathAdd')}
              </button>
            </div>
          </div>

          <div>
            <span className="mb-1.5 block text-xs text-muted">{t('project.serviceNames')}</span>
            <div className="space-y-2">
              {serviceNames.map((unit, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    value={unit}
                    onChange={(e) => updateServiceName(index, e.target.value)}
                    placeholder={t('project.serviceNamePlaceholder')}
                    spellCheck={false}
                    className="aspro-input w-full px-2 py-1.5 font-mono text-xs text-fg placeholder-faint focus:border-azure focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => removeServiceName(index)}
                    className="shrink-0 rounded px-1.5 py-1 text-faint hover:bg-line hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setServiceNames((prev) => [...prev, ''])}
                className="text-xs text-azure hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
              >
                {t('project.serviceNameAdd')}
              </button>
            </div>
          </div>
        </div>

        {error && <p className="mt-3 shrink-0 text-xs text-coral">{error}</p>}

        <div className="mt-5 flex shrink-0 justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded px-4 py-2 text-sm text-dim hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
          >
            {t('project.cancel')}
          </button>
          <button
            type="submit"
            disabled={saving}
            className="aspro-button aspro-button-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t('project.save')}
          </button>
        </div>
      </form>
    </div>
  );
}
