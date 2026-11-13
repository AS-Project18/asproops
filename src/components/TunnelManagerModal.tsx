import { useEffect, useState } from 'react';
import type {
  SshTunnel,
  SshTunnelCreateInput,
  SshTunnelRuntimeStatus,
  TunnelType,
} from '../shared/types';
import { useI18n } from '../i18n';

interface TunnelManagerModalProps {
  sessionId: string;
  sessionHost?: string;
  onClose: () => void;
}

interface TunnelFormState {
  id?: string;
  name: string;
  type: TunnelType;
  localHost: string;
  localPort: string;
  remoteHost: string;
  remotePort: string;
  autoStart: boolean;
}

const EMPTY_FORM: TunnelFormState = {
  name: '',
  type: 'local',
  localHost: '127.0.0.1',
  localPort: '',
  remoteHost: '127.0.0.1',
  remotePort: '',
  autoStart: false,
};

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val < 10 ? val.toFixed(1) : Math.round(val)} ${units[i] || 'B'}`;
}

export function TunnelManagerModal({ sessionId, sessionHost, onClose }: TunnelManagerModalProps) {
  const { t } = useI18n();
  const [tunnels, setTunnels] = useState<SshTunnel[]>([]);
  const [statuses, setStatuses] = useState<Record<string, SshTunnelRuntimeStatus>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  // Form mode
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<TunnelFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Delete confirm
  const [confirmDelete, setConfirmDelete] = useState<SshTunnel | null>(null);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [list, statMap] = await Promise.all([
        window.ssh.tunnel.list(sessionId),
        window.ssh.tunnel.statuses(),
      ]);
      setTunnels(list);
      setStatuses(statMap);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
    const unsub = window.ssh.tunnel.onStatus((status) => {
      setStatuses((prev) => ({
        ...prev,
        [status.id]: status,
      }));
    });
    return unsub;
  }, [sessionId]);

  const handleStart = async (id: string) => {
    setPendingId(id);
    setError(null);
    try {
      await window.ssh.tunnel.start(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingId(null);
    }
  };

  const handleStop = async (id: string) => {
    setPendingId(id);
    setError(null);
    try {
      await window.ssh.tunnel.stop(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingId(null);
    }
  };

  const handleOpenBrowser = (port: number) => {
    void window.ssh.app.openExternal(`http://127.0.0.1:${port}`);
  };

  const handleOpenAdd = () => {
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowForm(true);
  };

  const handleOpenEdit = (t: SshTunnel) => {
    setForm({
      id: t.id,
      name: t.name,
      type: t.type,
      localHost: t.localHost,
      localPort: String(t.localPort),
      remoteHost: t.remoteHost,
      remotePort: String(t.remotePort),
      autoStart: t.autoStart,
    });
    setFormError(null);
    setShowForm(true);
  };

  const handlePreset = (preset: {
    name: string;
    type: TunnelType;
    localPort: number;
    remotePort?: number;
  }) => {
    setForm((prev) => ({
      ...prev,
      name: preset.name,
      type: preset.type,
      localPort: String(preset.localPort),
      remotePort: preset.remotePort !== undefined ? String(preset.remotePort) : prev.remotePort,
      remoteHost: '127.0.0.1',
    }));
  };

  const handleSaveForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setFormError(t('tunnel.errorName'));
      return;
    }
    const localPort = Number.parseInt(form.localPort, 10);
    if (!localPort || localPort < 1 || localPort > 65535) {
      setFormError(t('tunnel.errorLocalPort'));
      return;
    }

    let remotePort = 0;
    if (form.type !== 'dynamic') {
      remotePort = Number.parseInt(form.remotePort, 10);
      if (!remotePort || remotePort < 1 || remotePort > 65535) {
        setFormError(t('tunnel.errorRemotePort'));
        return;
      }
    }

    setSaving(true);
    setFormError(null);
    try {
      if (form.id) {
        await window.ssh.tunnel.update(form.id, {
          name: form.name.trim(),
          type: form.type,
          localHost: form.localHost.trim() || '127.0.0.1',
          localPort,
          remoteHost: form.remoteHost.trim() || '127.0.0.1',
          remotePort,
          autoStart: form.autoStart,
        });
      } else {
        const input: SshTunnelCreateInput = {
          sessionId,
          name: form.name.trim(),
          type: form.type,
          localHost: form.localHost.trim() || '127.0.0.1',
          localPort,
          remoteHost: form.remoteHost.trim() || '127.0.0.1',
          remotePort,
          autoStart: form.autoStart,
        };
        await window.ssh.tunnel.create(input);
      }
      setShowForm(false);
      await loadData();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (tunnel: SshTunnel) => {
    setConfirmDelete(null);
    try {
      await window.ssh.tunnel.remove(tunnel.id);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const activeCount = Object.values(statuses).filter((s) => s.state === 'active').length;

  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center bg-black/80 p-2 sm:p-4 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex max-h-[92vh] sm:max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <header className="flex items-center justify-between border-b border-line/60 bg-raised px-5 py-3.5">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-azure/10 text-base font-bold text-azure">
              ⇄
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-fg">{t('tunnel.title')}</h3>
                {activeCount > 0 && (
                  <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                    {activeCount} {t('tunnel.active').toLowerCase()}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-faint">
                {sessionHost ? `${sessionHost} • ` : ''}
                {t('tunnel.subtitle')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!showForm && (
              <button
                type="button"
                onClick={handleOpenAdd}
                className="flex items-center gap-1.5 rounded-lg bg-azure px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-azure-hover"
              >
                <span>＋</span>
                <span>{t('tunnel.add')}</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-faint hover:bg-line/40 hover:text-fg"
              title="Close"
            >
              ✕
            </button>
          </div>
        </header>

        {/* Global Error Banner */}
        {error && (
          <div className="mx-5 mt-3 rounded-lg border border-coral/40 bg-coral/10 px-3.5 py-2 text-xs text-coral">
            {error}
          </div>
        )}

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {showForm ? (
            /* Add / Edit Form */
            <form
              onSubmit={(e) => void handleSaveForm(e)}
              className="space-y-4 rounded-xl border border-line/70 bg-raised/50 p-4"
            >
              <div className="flex items-center justify-between border-b border-line/40 pb-2.5">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted">
                  {form.id ? t('tunnel.edit') : t('tunnel.add')}
                </h4>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-faint">{t('tunnel.presets')}</span>
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        handlePreset({
                          name: 'PostgreSQL',
                          type: 'local',
                          localPort: 5432,
                          remotePort: 5432,
                        })
                      }
                      className="rounded bg-line/60 px-1.5 py-0.5 text-[10px] text-fg hover:bg-azure/20 hover:text-azure"
                    >
                      {t('tunnel.presetPg')}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handlePreset({
                          name: 'MySQL',
                          type: 'local',
                          localPort: 3306,
                          remotePort: 3306,
                        })
                      }
                      className="rounded bg-line/60 px-1.5 py-0.5 text-[10px] text-fg hover:bg-azure/20 hover:text-azure"
                    >
                      {t('tunnel.presetMysql')}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handlePreset({
                          name: 'Redis',
                          type: 'local',
                          localPort: 6379,
                          remotePort: 6379,
                        })
                      }
                      className="rounded bg-line/60 px-1.5 py-0.5 text-[10px] text-fg hover:bg-azure/20 hover:text-azure"
                    >
                      {t('tunnel.presetRedis')}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handlePreset({
                          name: 'Web App',
                          type: 'local',
                          localPort: 8080,
                          remotePort: 8080,
                        })
                      }
                      className="rounded bg-line/60 px-1.5 py-0.5 text-[10px] text-fg hover:bg-azure/20 hover:text-azure"
                    >
                      {t('tunnel.presetWeb')}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handlePreset({
                          name: 'SOCKS5 Proxy',
                          type: 'dynamic',
                          localPort: 1080,
                        })
                      }
                      className="rounded bg-line/60 px-1.5 py-0.5 text-[10px] text-fg hover:bg-azure/20 hover:text-azure"
                    >
                      {t('tunnel.presetSocks')}
                    </button>
                  </div>
                </div>
              </div>

              {/* Tunnel Type Selection */}
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-muted">
                  {t('tunnel.type')}
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, type: 'local' })}
                    className={`flex flex-col rounded-lg border p-2.5 text-left transition ${
                      form.type === 'local'
                        ? 'border-azure bg-azure/10 text-fg ring-1 ring-azure'
                        : 'border-line/60 bg-surface/50 text-dim hover:border-line hover:text-fg'
                    }`}
                  >
                    <span className="text-xs font-bold text-fg">{t('tunnel.typeLocal')}</span>
                    <span className="mt-1 text-[10px] text-faint">
                      Local Port → Remote Host:Port
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setForm({ ...form, type: 'remote' })}
                    className={`flex flex-col rounded-lg border p-2.5 text-left transition ${
                      form.type === 'remote'
                        ? 'border-azure bg-azure/10 text-fg ring-1 ring-azure'
                        : 'border-line/60 bg-surface/50 text-dim hover:border-line hover:text-fg'
                    }`}
                  >
                    <span className="text-xs font-bold text-fg">{t('tunnel.typeRemote')}</span>
                    <span className="mt-1 text-[10px] text-faint">
                      Remote Server Port → Local Port
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setForm({ ...form, type: 'dynamic' })}
                    className={`flex flex-col rounded-lg border p-2.5 text-left transition ${
                      form.type === 'dynamic'
                        ? 'border-azure bg-azure/10 text-fg ring-1 ring-azure'
                        : 'border-line/60 bg-surface/50 text-dim hover:border-line hover:text-fg'
                    }`}
                  >
                    <span className="text-xs font-bold text-fg">{t('tunnel.typeDynamic')}</span>
                    <span className="mt-1 text-[10px] text-faint">SOCKS5 Proxy (RFC 1928)</span>
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] text-faint">
                  {form.type === 'local' && t('tunnel.typeLocalDesc')}
                  {form.type === 'remote' && t('tunnel.typeRemoteDesc')}
                  {form.type === 'dynamic' && t('tunnel.typeDynamicDesc')}
                </p>
              </div>

              {/* Tunnel Name */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">
                  {t('tunnel.name')}
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder={t('tunnel.namePlaceholder')}
                  className="aspro-input w-full px-3 py-1.5 text-xs text-fg"
                />
              </div>

              {/* Ports and Hosts */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted">
                    {t('tunnel.localPort')}
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    required
                    value={form.localPort}
                    onChange={(e) => setForm({ ...form, localPort: e.target.value })}
                    placeholder={form.type === 'dynamic' ? '1080' : '5432'}
                    className="aspro-input w-full font-mono text-xs text-fg"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-muted">
                    {t('tunnel.localHost')}
                  </label>
                  <input
                    type="text"
                    value={form.localHost}
                    onChange={(e) => setForm({ ...form, localHost: e.target.value })}
                    placeholder="127.0.0.1"
                    className="aspro-input w-full font-mono text-xs text-fg"
                  />
                </div>
              </div>

              {form.type !== 'dynamic' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-muted">
                      {t('tunnel.remoteHost')}
                    </label>
                    <input
                      type="text"
                      value={form.remoteHost}
                      onChange={(e) => setForm({ ...form, remoteHost: e.target.value })}
                      placeholder="127.0.0.1"
                      className="aspro-input w-full font-mono text-xs text-fg"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-muted">
                      {t('tunnel.remotePort')}
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={65535}
                      required
                      value={form.remotePort}
                      onChange={(e) => setForm({ ...form, remotePort: e.target.value })}
                      placeholder="5432"
                      className="aspro-input w-full font-mono text-xs text-fg"
                    />
                  </div>
                </div>
              )}

              {/* Auto start checkbox */}
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="auto-start-checkbox"
                  checked={form.autoStart}
                  onChange={(e) => setForm({ ...form, autoStart: e.target.checked })}
                  className="rounded border-line bg-surface text-azure focus:ring-azure"
                />
                <label
                  htmlFor="auto-start-checkbox"
                  className="cursor-pointer text-xs font-medium text-fg"
                >
                  {t('tunnel.autoStart')}
                </label>
              </div>

              {formError && <p className="text-xs text-coral">{formError}</p>}

              {/* Form buttons */}
              <div className="flex justify-end gap-2 pt-2 border-t border-line/40">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="rounded-lg px-4 py-1.5 text-xs font-medium text-dim hover:text-fg"
                >
                  {t('project.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="aspro-button aspro-button-primary px-4 py-1.5 text-xs font-semibold disabled:opacity-40"
                >
                  {saving ? t('local.saving') : t('sftp.save')}
                </button>
              </div>
            </form>
          ) : loading ? (
            <div className="flex h-36 items-center justify-center text-xs text-faint">
              {t('sftp.loading')}
            </div>
          ) : tunnels.length === 0 ? (
            /* Empty State */
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line/70 p-8 text-center">
              <span className="mb-2 text-3xl">⇄</span>
              <h4 className="text-sm font-semibold text-fg">{t('tunnel.empty')}</h4>
              <p className="mt-1 max-w-md text-xs text-faint">{t('tunnel.emptyDetail')}</p>
              <button
                type="button"
                onClick={handleOpenAdd}
                className="mt-4 flex items-center gap-1.5 rounded-lg bg-azure px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-azure-hover"
              >
                <span>＋</span>
                <span>{t('tunnel.add')}</span>
              </button>
            </div>
          ) : (
            /* Tunnel Cards List */
            <div className="space-y-2.5">
              {tunnels.map((tunnel) => {
                const status = statuses[tunnel.id] || {
                  id: tunnel.id,
                  state: 'inactive',
                  connectionsCount: 0,
                  bytesTransferred: 0,
                };
                const isActive = status.state === 'active';
                const isError = status.state === 'error';
                const isPending = pendingId === tunnel.id;

                return (
                  <div
                    key={tunnel.id}
                    className={`group relative flex flex-col rounded-xl border p-3.5 transition ${
                      isActive
                        ? 'border-emerald-500/40 bg-emerald-950/10'
                        : isError
                          ? 'border-coral/40 bg-coral/5'
                          : 'border-line/70 bg-raised/30 hover:border-line'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      {/* Left info */}
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        <span
                          className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                            isActive
                              ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]'
                              : isError
                                ? 'bg-coral'
                                : 'bg-gray-500'
                          }`}
                          title={status.state}
                        />

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-bold text-fg">{tunnel.name}</span>
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                                tunnel.type === 'dynamic'
                                  ? 'bg-purple-500/20 text-purple-400'
                                  : tunnel.type === 'remote'
                                    ? 'bg-amber-500/20 text-amber-400'
                                    : 'bg-azure/20 text-azure'
                              }`}
                            >
                              {tunnel.type === 'dynamic'
                                ? 'SOCKS5'
                                : tunnel.type === 'remote'
                                  ? 'Remote (-R)'
                                  : 'Local (-L)'}
                            </span>
                            {tunnel.autoStart && (
                              <span className="rounded bg-line/50 px-1.5 py-0.5 text-[9px] text-faint">
                                {t('tunnel.autoStartBadge')}
                              </span>
                            )}
                          </div>

                          {/* Route arrow representation */}
                          <div className="mt-1 flex items-center gap-1.5 font-mono text-[11px] text-muted">
                            {tunnel.type === 'dynamic' ? (
                              <span>
                                127.0.0.1:{tunnel.localPort} ➔ SOCKS5 Proxy ➔ {sessionHost || 'remote'}
                              </span>
                            ) : tunnel.type === 'remote' ? (
                              <span>
                                server:{tunnel.remotePort} ➔ 127.0.0.1:{tunnel.localPort}
                              </span>
                            ) : (
                              <span>
                                127.0.0.1:{tunnel.localPort} ➔ {tunnel.remoteHost}:{tunnel.remotePort}
                              </span>
                            )}
                          </div>

                          {/* Active live metrics */}
                          {isActive && (
                            <div className="mt-1.5 flex items-center gap-3 text-[10px] text-emerald-400">
                              <span>
                                {t('tunnel.connections', { count: status.connectionsCount })}
                              </span>
                              <span>•</span>
                              <span>
                                {t('tunnel.bytes', {
                                  bytes: formatBytes(status.bytesTransferred),
                                })}
                              </span>
                            </div>
                          )}

                          {isError && status.error && (
                            <div className="mt-1.5 text-[11px] text-coral">{status.error}</div>
                          )}
                        </div>
                      </div>

                      {/* Right action buttons */}
                      <div className="flex shrink-0 items-center gap-1.5">
                        {/* Open in browser (if local port) */}
                        {isActive && tunnel.type === 'local' && (
                          <button
                            type="button"
                            onClick={() => handleOpenBrowser(tunnel.localPort)}
                            title={t('tunnel.openBrowser')}
                            className="flex items-center gap-1 rounded-lg border border-line/60 bg-surface/70 px-2.5 py-1 text-xs text-dim hover:border-azure hover:text-azure"
                          >
                            <span>🌐</span>
                            <span className="hidden sm:inline">{t('tunnel.openBrowser')}</span>
                          </button>
                        )}

                        {/* Start / Stop Toggle */}
                        {isActive ? (
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => void handleStop(tunnel.id)}
                            className="flex items-center gap-1.5 rounded-lg border border-coral/40 bg-coral/10 px-3 py-1 text-xs font-semibold text-coral hover:bg-coral/20 disabled:opacity-40"
                          >
                            <span>■</span>
                            <span>{isPending ? t('tunnel.stopping') : t('tunnel.stop')}</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => void handleStart(tunnel.id)}
                            className="flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-40"
                          >
                            <span>▶</span>
                            <span>{isPending ? t('tunnel.starting') : t('tunnel.start')}</span>
                          </button>
                        )}

                        {/* Edit Button */}
                        <button
                          type="button"
                          disabled={isActive}
                          onClick={() => handleOpenEdit(tunnel)}
                          title={t('tunnel.edit')}
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-faint hover:bg-line/60 hover:text-fg disabled:opacity-30"
                        >
                          ✎
                        </button>

                        {/* Delete Button */}
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(tunnel)}
                          title={t('portforward.delete')}
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-faint hover:bg-coral/20 hover:text-coral"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Delete Confirmation Modal */}
        {confirmDelete && (
          <div
            className="fixed inset-0 z-[160] flex items-center justify-center bg-black/80 p-4"
            onClick={() => setConfirmDelete(null)}
          >
            <div
              className="w-full max-w-sm rounded-xl border border-line bg-surface p-5 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h4 className="text-sm font-bold text-fg">
                {t('tunnel.deleteConfirmTitle', { name: confirmDelete.name })}
              </h4>
              <p className="mt-2 text-xs text-muted">{t('tunnel.deleteConfirmDesc')}</p>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmDelete(null)}
                  className="rounded-lg px-3 py-1.5 text-xs text-dim hover:text-fg"
                >
                  {t('project.cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(confirmDelete)}
                  className="rounded-lg bg-coral px-3 py-1.5 text-xs font-semibold text-abyss hover:bg-coral-bright"
                >
                  {t('portforward.delete')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
