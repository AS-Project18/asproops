import { useEffect, useMemo, useState } from 'react';
import type { ForwardDirection, PortForwardRule, PortForwardStatus } from '../shared/types';
import { useI18n } from '../i18n';

/**
 * Panel Port Forwarding — aturan tersimpan (PortForwardRule) terpisah dari
 * status tunnel yang sedang berjalan (PortForwardStatus, murni in-memory di
 * main process). Satu aturan bisa dijalankan/dihentikan berkali-kali tanpa
 * kehilangan definisinya, mirip pola Project/DeployTemplate.
 */

interface PortForwardPanelProps {
  sessionId: string;
}

function directionSummary(rule: PortForwardRule): string {
  const local = `${rule.localHost || '127.0.0.1'}:${rule.localPort}`;
  const remote = `${rule.remoteHost}:${rule.remotePort}`;
  return rule.direction === 'local' ? `${local} → ${remote}` : `${remote} → ${local}`;
}

interface RuleFormState {
  name: string;
  direction: ForwardDirection;
  localHost: string;
  localPort: string;
  remoteHost: string;
  remotePort: string;
}

const EMPTY_FORM: RuleFormState = {
  name: '',
  direction: 'local',
  localHost: '127.0.0.1',
  localPort: '',
  remoteHost: '127.0.0.1',
  remotePort: '',
};

export function PortForwardPanel({ sessionId }: PortForwardPanelProps) {
  const { t } = useI18n();
  const [rules, setRules] = useState<PortForwardRule[]>([]);
  const [active, setActive] = useState<Map<string, PortForwardStatus>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [form, setForm] = useState<RuleFormState | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<PortForwardRule | null>(null);

  const refresh = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [ruleList, activeList] = await Promise.all([
        window.ssh.portForward.listRules(sessionId),
        window.ssh.portForward.listActive(sessionId),
      ]);
      setRules(ruleList);
      setActive(new Map(activeList.map((s) => [s.ruleId, s])));
    } catch (err) {
      setLoadError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [sessionId]);

  useEffect(() => {
    return window.ssh.portForward.onStatus((status) => {
      if (status.sessionId !== sessionId) return;
      setActive((prev) => {
        const next = new Map(prev);
        if (status.state === 'closed') next.delete(status.ruleId);
        else next.set(status.ruleId, status);
        return next;
      });
    });
  }, [sessionId]);

  const sortedRules = useMemo(
    () => [...rules].sort((a, b) => a.name.localeCompare(b.name)),
    [rules],
  );

  const openCreateForm = () => {
    setEditingId(null);
    setFormError(null);
    setForm({ ...EMPTY_FORM });
  };

  const openEditForm = (rule: PortForwardRule) => {
    setEditingId(rule.id);
    setFormError(null);
    setForm({
      name: rule.name,
      direction: rule.direction,
      localHost: rule.localHost,
      localPort: String(rule.localPort),
      remoteHost: rule.remoteHost,
      remotePort: String(rule.remotePort),
    });
  };

  const closeForm = () => {
    setForm(null);
    setEditingId(null);
    setFormError(null);
  };

  const submitForm = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form) return;

    const localPort = Number(form.localPort);
    const remotePort = Number(form.remotePort);
    if (!form.name.trim()) {
      setFormError(t('portforward.errorName'));
      return;
    }
    if (!Number.isInteger(localPort) || localPort < 1 || localPort > 65535) {
      setFormError(t('portforward.errorLocalPort'));
      return;
    }
    if (!Number.isInteger(remotePort) || remotePort < 1 || remotePort > 65535) {
      setFormError(t('portforward.errorRemotePort'));
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      const input = {
        name: form.name.trim(),
        direction: form.direction,
        localHost: form.localHost.trim() || '127.0.0.1',
        localPort,
        remoteHost: form.remoteHost.trim() || '127.0.0.1',
        remotePort,
      };
      if (editingId) await window.ssh.portForward.updateRule(editingId, input);
      else await window.ssh.portForward.createRule(sessionId, input);
      closeForm();
      await refresh();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const toggleTunnel = async (rule: PortForwardRule) => {
    setPending(rule.id);
    setActionError(null);
    try {
      const status = active.get(rule.id);
      if (status) await window.ssh.portForward.stop(status.tunnelId);
      else await window.ssh.portForward.start(rule.id);
      await refresh();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setPending(null);
    }
  };

  const deleteRule = async (rule: PortForwardRule) => {
    setConfirmDelete(null);
    const status = active.get(rule.id);
    if (status) await window.ssh.portForward.stop(status.tunnelId).catch(() => {});
    await window.ssh.portForward.removeRule(rule.id);
    await refresh();
  };

  return (
    <section className="aspro-local-panel">
      <div className="aspro-local-title">
        <div>
          <span>{t('nav.portforward')}</span>
          <small>{t('portforward.subtitle', { count: sortedRules.length })}</small>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => void refresh()} title={t('service.refresh')}>
            ⟳
          </button>
          <button onClick={openCreateForm} title={t('portforward.add')}>
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
      ) : sortedRules.length === 0 ? (
        <div className="aspro-local-empty">
          <strong className="mb-1 block text-dim">{t('portforward.empty')}</strong>
          <span>{t('portforward.emptyDetail')}</span>
        </div>
      ) : (
        <div className="aspro-local-list">
          {sortedRules.map((rule) => {
            const status = active.get(rule.id);
            const isActive = status?.state === 'active';
            const isError = status?.state === 'error';
            return (
              <div key={rule.id} className="aspro-local-row group">
                <span
                  className="aspro-local-icon"
                  style={{ color: isError ? '#ff5d5d' : isActive ? '#58e879' : '#5b6275' }}
                  title={
                    isError
                      ? status?.message
                      : isActive
                        ? t('portforward.active')
                        : t('portforward.inactive')
                  }
                >
                  ●
                </span>
                <div className="min-w-0 flex-1">
                  <strong>{rule.name}</strong>
                  <small className="font-mono">
                    {rule.direction === 'local' ? '⇥ ' : '⇤ '}
                    {directionSummary(rule)}
                  </small>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    disabled={pending === rule.id}
                    onClick={() => void toggleTunnel(rule)}
                    title={isActive ? t('portforward.stop') : t('portforward.start')}
                    className="rounded px-1.5 py-1 text-faint hover:bg-line hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-azure disabled:opacity-30"
                  >
                    {isActive ? '■' : '▶'}
                  </button>
                  <button
                    onClick={() => openEditForm(rule)}
                    title={t('portforward.edit')}
                    className="rounded px-1.5 py-1 text-faint opacity-0 hover:bg-line hover:text-fg group-hover:opacity-100 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
                  >
                    ✎
                  </button>
                  <button
                    onClick={() => setConfirmDelete(rule)}
                    title={t('portforward.delete')}
                    className="rounded px-1.5 py-1 text-faint opacity-0 hover:bg-line hover:text-coral group-hover:opacity-100 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
                  >
                    ✕
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
          <form
            onSubmit={(e) => void submitForm(e)}
            className="w-full max-w-md rounded-lg border border-line bg-raised p-6"
          >
            <h2 className="text-sm font-semibold text-fg">
              {editingId ? t('portforward.editTitle') : t('portforward.addTitle')}
            </h2>

            <div className="mt-4 space-y-3">
              <div>
                <span className="mb-1.5 block text-xs text-muted">{t('portforward.name')}</span>
                <input
                  autoFocus
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder={t('portforward.namePlaceholder')}
                  className="aspro-input w-full px-3 py-2 text-sm text-fg placeholder-faint focus:border-azure focus:outline-none"
                />
              </div>

              <div>
                <span className="mb-1.5 block text-xs text-muted">
                  {t('portforward.direction')}
                </span>
                <select
                  value={form.direction}
                  onChange={(e) =>
                    setForm({ ...form, direction: e.target.value as ForwardDirection })
                  }
                  className="aspro-input w-full px-3 py-2 text-sm text-fg focus:border-azure focus:outline-none"
                >
                  <option value="local">{t('portforward.directionLocal')}</option>
                  <option value="remote">{t('portforward.directionRemote')}</option>
                </select>
                <small className="mt-1 block text-[11px] text-faint">
                  {form.direction === 'local'
                    ? t('portforward.directionLocalDesc')
                    : t('portforward.directionRemoteDesc')}
                </small>
              </div>

              <div className="flex gap-2">
                <div className="w-2/3">
                  <span className="mb-1.5 block text-xs text-muted">
                    {t('portforward.localHost')}
                  </span>
                  <input
                    value={form.localHost}
                    onChange={(e) => setForm({ ...form, localHost: e.target.value })}
                    placeholder="127.0.0.1"
                    spellCheck={false}
                    className="aspro-input w-full px-2 py-1.5 font-mono text-xs text-fg placeholder-faint focus:border-azure focus:outline-none"
                  />
                </div>
                <div className="w-1/3">
                  <span className="mb-1.5 block text-xs text-muted">
                    {t('portforward.localPort')}
                  </span>
                  <input
                    value={form.localPort}
                    onChange={(e) => setForm({ ...form, localPort: e.target.value })}
                    placeholder="5433"
                    inputMode="numeric"
                    spellCheck={false}
                    className="aspro-input w-full px-2 py-1.5 font-mono text-xs text-fg placeholder-faint focus:border-azure focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <div className="w-2/3">
                  <span className="mb-1.5 block text-xs text-muted">
                    {t('portforward.remoteHost')}
                  </span>
                  <input
                    value={form.remoteHost}
                    onChange={(e) => setForm({ ...form, remoteHost: e.target.value })}
                    placeholder="127.0.0.1"
                    spellCheck={false}
                    className="aspro-input w-full px-2 py-1.5 font-mono text-xs text-fg placeholder-faint focus:border-azure focus:outline-none"
                  />
                </div>
                <div className="w-1/3">
                  <span className="mb-1.5 block text-xs text-muted">
                    {t('portforward.remotePort')}
                  </span>
                  <input
                    value={form.remotePort}
                    onChange={(e) => setForm({ ...form, remotePort: e.target.value })}
                    placeholder="5432"
                    inputMode="numeric"
                    spellCheck={false}
                    className="aspro-input w-full px-2 py-1.5 font-mono text-xs text-fg placeholder-faint focus:border-azure focus:outline-none"
                  />
                </div>
              </div>
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
            <h2 className="break-all text-sm font-semibold text-fg">
              {t('portforward.deleteConfirmTitle', { name: confirmDelete.name })}
            </h2>
            <p className="mt-2 text-xs text-muted">{t('portforward.deleteConfirmDesc')}</p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => setConfirmDelete(null)}
                className="rounded px-4 py-2 text-sm text-dim hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
              >
                {t('project.cancel')}
              </button>
              <button
                onClick={() => void deleteRule(confirmDelete)}
                className="rounded bg-coral px-4 py-2 text-sm font-medium text-abyss hover:bg-coral-bright focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
              >
                {t('portforward.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
