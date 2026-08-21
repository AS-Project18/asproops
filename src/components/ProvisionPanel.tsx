import { useEffect, useState, type FormEvent } from 'react';
import type { ProvisionTemplate, DeployStep } from '../shared/types';
import { useI18n } from '../i18n';

/**
 * Panel Provisioning — daftar Provision Template (rangkaian langkah setup
 * server, mis. install Docker/Node.js) dan tempat menjalankannya langsung
 * di session yang aktif. Editor step-nya sengaja meniru struktur
 * DeployTemplatesSettings persis (DeployStep yang sama), bedanya provision
 * template dijalankan langsung dari panel ini (server-level), bukan lewat
 * Project seperti deploy template.
 */

interface ProvisionPanelProps {
  sessionId: string;
  onOpenRun: (sessionId: string, templateId: string, templateName: string) => void;
}

export function ProvisionPanel({ sessionId, onOpenRun }: ProvisionPanelProps) {
  const { t } = useI18n();
  const [templates, setTemplates] = useState<ProvisionTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ProvisionTemplate | 'new' | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ProvisionTemplate | null>(null);
  const [pendingRun, setPendingRun] = useState<ProvisionTemplate | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      setTemplates(await window.ssh.provision.listTemplates());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <section className="aspro-local-panel">
      <div className="aspro-local-title">
        <div>
          <span>{t('nav.provision')}</span>
          <small>{t('provision.subtitle', { count: templates.length })}</small>
        </div>
        <button onClick={() => setEditing('new')} title={t('provision.add')}>
          ＋
        </button>
      </div>

      {loading ? (
        <div className="aspro-local-empty">{t('sftp.loading')}</div>
      ) : templates.length === 0 ? (
        <div className="aspro-local-empty">
          <strong className="mb-1 block text-dim">{t('provision.empty')}</strong>
          <span>{t('provision.emptyDetail')}</span>
        </div>
      ) : (
        <div className="aspro-local-list">
          {templates.map((template) => (
            <div key={template.id} className="aspro-local-row group">
              <span className="aspro-local-icon">⚒</span>
              <div className="min-w-0 flex-1">
                <strong>{template.name}</strong>
                <small>{template.description || t('template.steps') + `: ${template.steps.length}`}</small>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  disabled={template.steps.length === 0}
                  onClick={() => setPendingRun(template)}
                  title={t('provision.run')}
                  className="rounded px-1.5 py-1 text-faint hover:bg-line hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-azure disabled:opacity-30"
                >
                  ▶
                </button>
                <button
                  onClick={() => setEditing(template)}
                  title={t('template.edit')}
                  className="rounded px-1.5 py-1 text-faint opacity-0 hover:bg-line hover:text-fg group-hover:opacity-100 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
                >
                  ✎
                </button>
                <button
                  onClick={() => setPendingDelete(template)}
                  title={t('template.delete')}
                  className="rounded px-1.5 py-1 text-faint opacity-0 hover:bg-line hover:text-coral group-hover:opacity-100 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <ProvisionTemplateFormDialog
          existing={editing === 'new' ? null : editing}
          onSave={async () => {
            setEditing(null);
            await refresh();
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      {pendingDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
          <div className="w-full max-w-sm rounded-lg border border-line bg-raised p-6">
            <h2 className="break-all text-sm font-semibold text-fg">
              {t('template.deleteConfirmTitle', { name: pendingDelete.name })}
            </h2>
            <p className="mt-2 text-xs text-muted">{t('template.deleteConfirmDesc')}</p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => setPendingDelete(null)}
                className="rounded px-4 py-2 text-sm text-dim hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
              >
                {t('project.cancel')}
              </button>
              <button
                onClick={async () => {
                  await window.ssh.provision.removeTemplate(pendingDelete.id);
                  setPendingDelete(null);
                  await refresh();
                }}
                className="rounded bg-coral px-4 py-2 text-sm font-medium text-abyss hover:bg-coral-bright focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
              >
                {t('template.delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingRun && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
          <div className="w-full max-w-sm rounded-lg border border-line bg-raised p-6">
            <h2 className="break-all text-sm font-semibold text-fg">
              {t('provision.confirmTitle', { name: pendingRun.name })}
            </h2>
            <p className="mt-2 text-xs text-muted">
              {t('provision.confirmDesc', { count: pendingRun.steps.length })}
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => setPendingRun(null)}
                className="rounded px-4 py-2 text-sm text-dim hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
              >
                {t('project.cancel')}
              </button>
              <button
                onClick={() => {
                  onOpenRun(sessionId, pendingRun.id, pendingRun.name);
                  setPendingRun(null);
                }}
                className="aspro-button aspro-button-primary"
              >
                {t('provision.confirmRun')}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function ProvisionTemplateFormDialog({
  existing,
  onSave,
  onCancel,
}: {
  existing: ProvisionTemplate | null;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [steps, setSteps] = useState<DeployStep[]>(existing?.steps ?? []);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const updateStep = (index: number, patch: Partial<DeployStep>) => {
    setSteps((prev) => prev.map((step, i) => (i === index ? { ...step, ...patch } : step)));
  };

  const removeStep = (index: number) => {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  };

  const moveStep = (index: number, delta: -1 | 1) => {
    setSteps((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError(t('template.name'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const cleanSteps = steps
        .filter((s) => s.label.trim() && s.command.trim())
        .map((s) => ({ ...s, label: s.label.trim(), command: s.command.trim() }));

      if (existing) {
        await window.ssh.provision.updateTemplate(existing.id, {
          name: name.trim(),
          description: description.trim() || undefined,
          steps: cleanSteps,
        });
      } else {
        const created = await window.ssh.provision.createTemplate({
          name: name.trim(),
          description: description.trim() || undefined,
        });
        if (cleanSteps.length > 0) {
          await window.ssh.provision.updateTemplate(created.id, { steps: cleanSteps });
        }
      }
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
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-lg border border-line bg-raised p-6"
      >
        <h2 className="shrink-0 text-sm font-semibold text-fg">
          {existing ? t('template.editTitle') : t('provision.addTitle')}
        </h2>

        <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          <div>
            <span className="mb-1.5 block text-xs text-muted">{t('template.name')}</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('provision.namePlaceholder')}
              className="aspro-input w-full px-3 py-2 text-sm text-fg placeholder-faint focus:border-azure focus:outline-none"
            />
          </div>

          <div>
            <span className="mb-1.5 block text-xs text-muted">{t('template.description')}</span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('template.descriptionPlaceholder')}
              className="aspro-input w-full px-3 py-2 text-sm text-fg placeholder-faint focus:border-azure focus:outline-none"
            />
          </div>

          <div>
            <span className="mb-1.5 block text-xs text-muted">{t('template.steps')}</span>
            <div className="space-y-2">
              {steps.map((step, index) => (
                <div key={step.id} className="flex items-start gap-2">
                  <div className="flex shrink-0 flex-col">
                    <button
                      type="button"
                      onClick={() => moveStep(index, -1)}
                      disabled={index === 0}
                      title={t('template.moveUp')}
                      className="rounded px-1 text-faint hover:bg-line hover:text-fg disabled:cursor-not-allowed disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveStep(index, 1)}
                      disabled={index === steps.length - 1}
                      title={t('template.moveDown')}
                      className="rounded px-1 text-faint hover:bg-line hover:text-fg disabled:cursor-not-allowed disabled:opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
                    >
                      ↓
                    </button>
                  </div>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <input
                      value={step.label}
                      onChange={(e) => updateStep(index, { label: e.target.value })}
                      placeholder={t('template.stepLabelPlaceholder')}
                      className="aspro-input w-full px-2 py-1.5 text-xs text-fg placeholder-faint focus:border-azure focus:outline-none"
                    />
                    <input
                      value={step.command}
                      onChange={(e) => updateStep(index, { command: e.target.value })}
                      placeholder={t('template.stepCommandPlaceholder')}
                      spellCheck={false}
                      className="aspro-input w-full px-2 py-1.5 font-mono text-xs text-fg placeholder-faint focus:border-azure focus:outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeStep(index)}
                    title={t('template.removeStep')}
                    className="shrink-0 rounded px-1.5 py-1 text-faint hover:bg-line hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setSteps((prev) => [...prev, { id: crypto.randomUUID(), label: '', command: '' }])
                }
                className="text-xs text-azure hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
              >
                {t('template.addStep')}
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
            {t('template.cancel')}
          </button>
          <button
            type="submit"
            disabled={saving}
            className="aspro-button aspro-button-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t('template.save')}
          </button>
        </div>
      </form>
    </div>
  );
}
