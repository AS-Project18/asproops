import { useEffect, useMemo, useState } from 'react';
import type { GitAction, GitStatus, ProjectProfile } from '../shared/types';
import { useI18n } from '../i18n';

/**
 * Panel Git — status repo (branch, ahead/behind, commit terakhir, file yang
 * berubah) untuk satu Project, plus fetch/pull. Sengaja tidak ada push: itu
 * butuh kredensial/akses tulis yang jauh lebih riskan untuk dipicu dari UI
 * dibanding sekadar melihat status atau menarik perubahan.
 */

interface GitPanelProps {
  sessionId: string;
  /** id project yang mau langsung dipilih, mis. dari chip di ProjectsPanel. */
  focusProjectId?: string | null;
}

const STATUS_COLOR: Record<string, string> = {
  M: '#ffb52e',
  A: '#58e879',
  D: '#ff5a68',
  R: '#8f83ff',
  C: '#8f83ff',
  U: '#ff5a68',
  '?': '#716878',
};

function statusColor(code: string): string {
  const primary = code.trim().charAt(0) || code.charAt(1);
  return STATUS_COLOR[primary] ?? '#8b7e94';
}

export function GitPanel({ sessionId, focusProjectId }: GitPanelProps) {
  const { t } = useI18n();
  const [projects, setProjects] = useState<ProjectProfile[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<GitAction | null>(null);
  const [actionOutput, setActionOutput] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    void window.ssh.projects.list(sessionId).then(setProjects);
  }, [sessionId]);

  useEffect(() => {
    if (focusProjectId) setSelectedId(focusProjectId);
  }, [focusProjectId]);

  // Kalau belum ada pilihan (mis. panel baru dibuka tanpa chip) dan daftar
  // project sudah datang, pilih yang pertama supaya panel tidak kosong pasif.
  useEffect(() => {
    if (!selectedId && projects.length > 0) setSelectedId(projects[0].id);
  }, [projects, selectedId]);

  const project = useMemo(() => projects.find((p) => p.id === selectedId) ?? null, [projects, selectedId]);

  const refresh = async (target: ProjectProfile) => {
    setLoading(true);
    setError(null);
    setActionOutput(null);
    setActionError(null);
    try {
      setStatus(await window.ssh.git.status(sessionId, target.path));
    } catch (err) {
      setError((err as Error).message);
      setStatus(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (project) void refresh(project);
    else {
      setStatus(null);
      setLoading(false);
    }
  }, [project?.id, project?.path]);

  const runAction = async (action: GitAction) => {
    if (!project) return;
    setPending(action);
    setActionError(null);
    setActionOutput(null);
    try {
      const output = await window.ssh.git.action(sessionId, project.path, action);
      setActionOutput(output || t('git.actionDone'));
      await refresh(project);
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setPending(null);
    }
  };

  return (
    <section className="aspro-local-panel">
      <div className="aspro-local-title">
        <div>
          <span>{t('nav.git')}</span>
          <small>{project ? project.path : t('git.subtitle')}</small>
        </div>
        <button onClick={() => project && void refresh(project)} title={t('service.refresh')} disabled={!project}>
          ⟳
        </button>
      </div>

      {projects.length > 0 && (
        <div className="mb-2">
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="aspro-input w-full px-2 py-1.5 text-xs text-fg focus:border-azure focus:outline-none"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {projects.length === 0 ? (
        <div className="aspro-local-empty">
          <strong className="mb-1 block text-dim">{t('git.noProjects')}</strong>
          <span>{t('git.noProjectsDetail')}</span>
        </div>
      ) : loading ? (
        <div className="aspro-local-empty">{t('sftp.loading')}</div>
      ) : error ? (
        <div className="aspro-local-empty">
          <strong className="mb-1 block text-dim">{t('git.error')}</strong>
          <span>{error}</span>
        </div>
      ) : !status?.isRepo ? (
        <div className="aspro-local-empty">
          <strong className="mb-1 block text-dim">{t('git.notRepo')}</strong>
          <span>{t('git.notRepoDetail')}</span>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="rounded-lg border border-line bg-panel p-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="font-mono font-semibold text-fg">⎇ {status.branch ?? '?'}</span>
              {status.upstream && <span className="text-faint">→ {status.upstream}</span>}
              {(status.ahead ?? 0) > 0 && <span className="text-azure">⇡{status.ahead}</span>}
              {(status.behind ?? 0) > 0 && <span className="text-coral">⇣{status.behind}</span>}
            </div>

            {status.lastCommit && (
              <div className="mt-2 border-t border-line pt-2 text-[11px] text-muted">
                <div className="truncate text-dim">{status.lastCommit.subject}</div>
                <div className="mt-0.5 font-mono text-faint">
                  {status.lastCommit.hash.slice(0, 7)} · {status.lastCommit.author} ·{' '}
                  {status.lastCommit.relativeDate}
                </div>
              </div>
            )}

            {status.remoteUrl && (
              <div className="mt-1.5 truncate font-mono text-[10px] text-faint">{status.remoteUrl}</div>
            )}

            <div className="mt-3 flex gap-2">
              <button
                onClick={() => void runAction('fetch')}
                disabled={pending !== null}
                className="aspro-button flex-1 px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40"
              >
                {pending === 'fetch' ? t('git.working') : t('git.fetch')}
              </button>
              <button
                onClick={() => void runAction('pull')}
                disabled={pending !== null}
                className="aspro-button aspro-button-primary flex-1 px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40"
              >
                {pending === 'pull' ? t('git.working') : t('git.pull')}
              </button>
            </div>

            {actionError && <p className="mt-2 text-[11px] text-coral">{actionError}</p>}
            {actionOutput && !actionError && (
              <pre className="mt-2 whitespace-pre-wrap font-mono text-[10px] text-faint">{actionOutput}</pre>
            )}
          </div>

          <div className="mt-3">
            <h3 className="mb-1.5 px-1 text-[11px] uppercase tracking-[0.14em] text-faint">
              {t('git.changes', { count: status.files.length })}
            </h3>
            {status.files.length === 0 ? (
              <div className="px-1 text-xs text-faint">{t('git.clean')}</div>
            ) : (
              <div className="space-y-1">
                {status.files.map((file) => (
                  <div
                    key={file.path}
                    className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-hover"
                  >
                    <span
                      className="w-6 shrink-0 text-center font-mono font-semibold"
                      style={{ color: statusColor(file.code) }}
                    >
                      {file.code.trim() || '?'}
                    </span>
                    <span className="truncate font-mono text-dim">{file.path}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
