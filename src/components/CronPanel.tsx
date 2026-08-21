import { useEffect, useState, type FormEvent } from 'react';
import type { CronJob } from '../shared/types';
import { useI18n } from '../i18n';

/**
 * Panel Cron Job manager — baca/tulis crontab milik pengguna SSH yang
 * sedang login (lihat catatan di electron/ssh/cron.ts soal kenapa cuma
 * pengguna sendiri, bukan `-u` user lain). `index` job dipakai sebagai
 * identitas baris untuk edit/hapus/toggle — SELALU refresh() dulu setelah
 * mutasi supaya index yang ditampilkan tetap sinkron dengan server.
 */

interface CronPanelProps {
  sessionId: string;
}

interface FormState {
  schedule: string;
  command: string;
  enabled: boolean;
}

const EMPTY_FORM: FormState = { schedule: '*/5 * * * *', command: '', enabled: true };

export function CronPanel({ sessionId }: CronPanelProps) {
  const { t } = useI18n();
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<CronJob | null>(null);

  const refresh = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setJobs(await window.ssh.cron.list(sessionId));
    } catch (err) {
      setLoadError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [sessionId]);

  const openCreateForm = () => {
    setEditingIndex(null);
    setFormError(null);
    setForm({ ...EMPTY_FORM });
  };

  const openEditForm = (job: CronJob) => {
    setEditingIndex(job.index);
    setFormError(null);
    setForm({ schedule: job.schedule, command: job.command, enabled: job.enabled });
  };

  const closeForm = () => {
    setForm(null);
    setEditingIndex(null);
    setFormError(null);
  };

  const submitForm = async (event: FormEvent) => {
    event.preventDefault();
    if (!form) return;
    if (!form.schedule.trim()) {
      setFormError(t('cron.errorSchedule'));
      return;
    }
    if (!form.command.trim()) {
      setFormError(t('cron.errorCommand'));
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      const input = { schedule: form.schedule.trim(), command: form.command.trim(), enabled: form.enabled };
      if (editingIndex !== null) await window.ssh.cron.update(sessionId, editingIndex, input);
      else await window.ssh.cron.create(sessionId, input);
      closeForm();
      await refresh();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async (job: CronJob) => {
    setPending(job.index);
    setActionError(null);
    try {
      await window.ssh.cron.update(sessionId, job.index, {
        schedule: job.schedule,
        command: job.command,
        enabled: !job.enabled,
      });
      await refresh();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setPending(null);
    }
  };

  const deleteJob = async (job: CronJob) => {
    setConfirmDelete(null);
    setActionError(null);
    try {
      await window.ssh.cron.remove(sessionId, job.index);
      await refresh();
    } catch (err) {
      setActionError((err as Error).message);
    }
  };

  return (
    <section className="aspro-local-panel">
      <div className="aspro-local-title">
        <div>
          <span>{t('nav.cron')}</span>
          <small>{t('cron.subtitle', { count: jobs.length })}</small>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => void refresh()} title={t('service.refresh')}>
            ⟳
          </button>
          <button onClick={openCreateForm} title={t('cron.add')}>
            ＋
          </button>
        </div>
      </div>

      {actionError && (
        <div className="mx-1 mt-2 rounded border border-coral/40 bg-coral/10 px-3 py-2 text-[11px] text-coral">
          {actionError}
        </div>
      )}

      {loading ? (
        <div className="aspro-local-empty">{t('sftp.loading')}</div>
      ) : loadError ? (
        <div className="aspro-local-empty">
          <strong className="mb-1 block text-dim">{t('service.error')}</strong>
          <span>{loadError}</span>
        </div>
      ) : jobs.length === 0 ? (
        <div className="aspro-local-empty">
          <strong className="mb-1 block text-dim">{t('cron.empty')}</strong>
          <span>{t('cron.emptyDetail')}</span>
        </div>
      ) : (
        <div className="aspro-local-list">
          {jobs.map((job) => (
            <div key={job.index} className="aspro-local-row group">
              <button
                disabled={pending === job.index}
                onClick={() => void toggleEnabled(job)}
                title={job.enabled ? t('cron.disable') : t('cron.enable')}
                className="aspro-local-icon disabled:opacity-30"
                style={{ color: job.enabled ? '#58e879' : '#5b6275' }}
              >
                ●
              </button>
              <div className="min-w-0 flex-1">
                <strong className="font-mono">{job.schedule}</strong>
                <small className="font-mono">{job.command}</small>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  onClick={() => openEditForm(job)}
                  title={t('cron.edit')}
                  className="rounded px-1.5 py-1 text-faint opacity-0 hover:bg-line hover:text-fg group-hover:opacity-100 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
                >
                  ✎
                </button>
                <button
                  onClick={() => setConfirmDelete(job)}
                  title={t('cron.delete')}
                  className="rounded px-1.5 py-1 text-faint opacity-0 hover:bg-line hover:text-coral group-hover:opacity-100 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
          <form
            onSubmit={(e) => void submitForm(e)}
            className="w-full max-w-md rounded-lg border border-line bg-raised p-6"
          >
            <h2 className="text-sm font-semibold text-fg">
              {editingIndex !== null ? t('cron.editTitle') : t('cron.addTitle')}
            </h2>

            <div className="mt-4 space-y-3">
              <div>
                <span className="mb-1.5 block text-xs text-muted">{t('cron.schedule')}</span>
                <input
                  autoFocus
                  value={form.schedule}
                  onChange={(e) => setForm({ ...form, schedule: e.target.value })}
                  placeholder="*/5 * * * *"
                  spellCheck={false}
                  className="aspro-input w-full px-3 py-2 font-mono text-sm text-fg placeholder-faint focus:border-azure focus:outline-none"
                />
                <small className="mt-1 block text-[11px] text-faint">{t('cron.scheduleDesc')}</small>
              </div>

              <div>
                <span className="mb-1.5 block text-xs text-muted">{t('cron.command')}</span>
                <input
                  value={form.command}
                  onChange={(e) => setForm({ ...form, command: e.target.value })}
                  placeholder={t('cron.commandPlaceholder')}
                  spellCheck={false}
                  className="aspro-input w-full px-3 py-2 font-mono text-sm text-fg placeholder-faint focus:border-azure focus:outline-none"
                />
              </div>

              <label className="flex items-center gap-2 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                />
                {t('cron.enabled')}
              </label>
            </div>

            {formError && <p className="mt-3 text-xs text-coral">{formError}</p>}

            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeForm}
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
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
          <div className="w-full max-w-sm rounded-lg border border-line bg-raised p-6">
            <h2 className="break-all text-sm font-semibold text-fg">{t('cron.deleteConfirmTitle')}</h2>
            <p className="mt-2 break-all font-mono text-xs text-muted">
              {confirmDelete.schedule} {confirmDelete.command}
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => setConfirmDelete(null)}
                className="rounded px-4 py-2 text-sm text-dim hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
              >
                {t('project.cancel')}
              </button>
              <button
                onClick={() => void deleteJob(confirmDelete)}
                className="rounded bg-coral px-4 py-2 text-sm font-medium text-abyss hover:bg-coral-bright focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
              >
                {t('cron.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
