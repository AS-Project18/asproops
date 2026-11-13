import { useEffect, useState } from 'react';
import type { SshKeyAlgorithm, SshKeyInfo } from '../shared/types';
import { useI18n } from '../i18n';

interface SshKeyManagerModalProps {
  activeSessionId?: string;
  activeSessionHost?: string;
  onSelectKey?: (privateKeyPath: string) => void;
  onClose: () => void;
}

export function SshKeyManagerModal({
  activeSessionId,
  activeSessionHost,
  onSelectKey,
  onClose,
}: SshKeyManagerModalProps) {
  const { t } = useI18n();
  const [keys, setKeys] = useState<SshKeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Generate form state
  const [showForm, setShowForm] = useState(false);
  const [algo, setAlgo] = useState<SshKeyAlgorithm>('ed25519');
  const [keyName, setKeyName] = useState('id_ed25519');
  const [comment, setComment] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [generating, setGenerating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Interaction feedback states
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [installingKey, setInstallingKey] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; isError: boolean } | null>(null);

  const loadKeys = async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await window.ssh.sshKey.list();
      setKeys(list);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadKeys();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const handleOpenForm = () => {
    setAlgo('ed25519');
    setKeyName('id_ed25519');
    setComment('');
    setPassphrase('');
    setFormError(null);
    setShowForm(true);
  };

  const handleAlgoChange = (nextAlgo: SshKeyAlgorithm) => {
    setAlgo(nextAlgo);
    if (keyName === 'id_ed25519' || keyName === 'id_rsa') {
      setKeyName(nextAlgo === 'ed25519' ? 'id_ed25519' : 'id_rsa');
    }
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyName.trim()) {
      setFormError('Nama berkas kunci wajib diisi.');
      return;
    }

    setGenerating(true);
    setFormError(null);
    try {
      await window.ssh.sshKey.generate({
        name: keyName.trim(),
        algorithm: algo,
        comment: comment.trim() || undefined,
        passphrase: passphrase || undefined,
      });
      setShowForm(false);
      await loadKeys();
      setToast({
        message: `Kunci ${keyName} berhasil dibuat di folder ~/.ssh!`,
        isError: false,
      });
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const handleCopyPub = async (key: SshKeyInfo) => {
    if (!key.publicKeyContent) return;
    try {
      await window.ssh.clipboard.writeText(key.publicKeyContent);
      setCopiedKey(key.name);
      setTimeout(() => setCopiedKey(null), 2500);
    } catch {
      // fallback
    }
  };

  const handleInstallToRemote = async (key: SshKeyInfo) => {
    if (!activeSessionId || !key.publicKeyContent) return;
    setInstallingKey(key.name);
    try {
      const res = await window.ssh.sshKey.installToRemote(activeSessionId, key.publicKeyContent);
      if (res.success) {
        setToast({
          message: t('sshKey.installed'),
          isError: false,
        });
      } else {
        setToast({
          message: t('sshKey.installFailed', { error: res.message || 'Unknown error' }),
          isError: true,
        });
      }
    } catch (err) {
      setToast({
        message: t('sshKey.installFailed', { error: (err as Error).message }),
        isError: true,
      });
    } finally {
      setInstallingKey(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[160] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <header className="flex items-center justify-between border-b border-line/60 bg-raised px-5 py-3.5">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-azure/10 text-base font-bold text-azure">
              🔑
            </span>
            <div>
              <h3 className="text-sm font-bold text-fg">{t('sshKey.title')}</h3>
              <p className="text-[11px] text-faint">{t('sshKey.subtitle')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!showForm && (
              <button
                type="button"
                onClick={handleOpenForm}
                className="flex items-center gap-1.5 rounded-lg bg-azure px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-azure-hover"
              >
                <span>＋</span>
                <span>{t('sshKey.generate')}</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-faint hover:bg-line/40 hover:text-fg"
            >
              ✕
            </button>
          </div>
        </header>

        {/* Toast Alert */}
        {toast && (
          <div
            className={`mx-5 mt-3 flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold ${
              toast.isError
                ? 'border border-coral/50 bg-coral/10 text-coral'
                : 'border border-emerald-500/50 bg-emerald-950/20 text-emerald-400'
            }`}
          >
            <span>{toast.isError ? '⚠️' : '✓'}</span>
            <span>{toast.message}</span>
          </div>
        )}

        {/* Global Error Banner */}
        {error && (
          <div className="mx-5 mt-3 rounded-lg border border-coral/40 bg-coral/10 px-3.5 py-2 text-xs text-coral">
            {error}
          </div>
        )}

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {showForm ? (
            /* Generate Key Form */
            <form
              onSubmit={(e) => void handleGenerate(e)}
              className="space-y-4 rounded-xl border border-line/70 bg-raised/50 p-4"
            >
              <h4 className="text-xs font-bold uppercase tracking-wider text-muted border-b border-line/40 pb-2">
                {t('sshKey.generate')}
              </h4>

              {/* Algorithm */}
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-muted">
                  {t('sshKey.algorithm')}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label
                    className={`flex flex-col rounded-lg border p-2.5 cursor-pointer transition ${
                      algo === 'ed25519'
                        ? 'border-azure bg-azure/10 text-fg ring-1 ring-azure'
                        : 'border-line/60 bg-surface/50 text-dim hover:text-fg'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="algo"
                        value="ed25519"
                        checked={algo === 'ed25519'}
                        onChange={() => handleAlgoChange('ed25519')}
                        className="text-azure focus:ring-azure"
                      />
                      <span className="text-xs font-bold text-fg">ED25519</span>
                      <span className="rounded bg-emerald-500/20 px-1.5 py-0.2 text-[9px] font-semibold text-emerald-400">
                        Rekomendasi
                      </span>
                    </div>
                    <span className="mt-1 text-[10px] text-faint">
                      Kurva elips 256-bit, tercepat dan paling aman saat ini.
                    </span>
                  </label>

                  <label
                    className={`flex flex-col rounded-lg border p-2.5 cursor-pointer transition ${
                      algo === 'rsa'
                        ? 'border-azure bg-azure/10 text-fg ring-1 ring-azure'
                        : 'border-line/60 bg-surface/50 text-dim hover:text-fg'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="algo"
                        value="rsa"
                        checked={algo === 'rsa'}
                        onChange={() => handleAlgoChange('rsa')}
                        className="text-azure focus:ring-azure"
                      />
                      <span className="text-xs font-bold text-fg">RSA 4096-bit</span>
                    </div>
                    <span className="mt-1 text-[10px] text-faint">
                      Standar industri tradisional dengan kompatibilitas server warisan luas.
                    </span>
                  </label>
                </div>
              </div>

              {/* Key Name */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">
                  {t('sshKey.name')}
                </label>
                <input
                  type="text"
                  required
                  value={keyName}
                  onChange={(e) => setKeyName(e.target.value)}
                  placeholder={t('sshKey.namePlaceholder')}
                  className="aspro-input w-full px-3 py-1.5 font-mono text-xs text-fg"
                />
                <small className="mt-1 block text-[10px] text-faint">
                  Kunci akan disimpan di ~/.ssh/{keyName} dan ~/.ssh/{keyName}.pub
                </small>
              </div>

              {/* Comment / Label */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">
                  {t('sshKey.comment')}
                </label>
                <input
                  type="text"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder={t('sshKey.commentPlaceholder')}
                  className="aspro-input w-full px-3 py-1.5 text-xs text-fg"
                />
              </div>

              {/* Passphrase */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">
                  {t('sshKey.passphrase')}
                </label>
                <input
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder={t('sshKey.passphrasePlaceholder')}
                  className="aspro-input w-full px-3 py-1.5 text-xs text-fg"
                />
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
                  disabled={generating}
                  className="aspro-button aspro-button-primary px-4 py-1.5 text-xs font-semibold disabled:opacity-40"
                >
                  {generating ? t('sshKey.generating') : t('sshKey.generate')}
                </button>
              </div>
            </form>
          ) : loading ? (
            <div className="flex h-36 items-center justify-center text-xs text-faint">
              {t('sftp.loading')}
            </div>
          ) : keys.length === 0 ? (
            /* Empty State */
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line/70 p-8 text-center">
              <span className="mb-2 text-3xl">🔑</span>
              <h4 className="text-sm font-semibold text-fg">{t('sshKey.empty')}</h4>
              <p className="mt-1 max-w-md text-xs text-faint">{t('sshKey.emptyDetail')}</p>
              <button
                type="button"
                onClick={handleOpenForm}
                className="mt-4 flex items-center gap-1.5 rounded-lg bg-azure px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-azure-hover"
              >
                <span>＋</span>
                <span>{t('sshKey.generate')}</span>
              </button>
            </div>
          ) : (
            /* Keys List */
            <div className="space-y-3">
              {keys.map((k) => {
                const isCopied = copiedKey === k.name;
                const isInstalling = installingKey === k.name;

                return (
                  <div
                    key={k.name}
                    className="flex flex-col rounded-xl border border-line/70 bg-raised/30 p-3.5 transition hover:border-line"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-bold text-fg font-mono">{k.name}</span>
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                              k.type === 'ED25519'
                                ? 'bg-emerald-500/20 text-emerald-400'
                                : 'bg-purple-500/20 text-purple-400'
                            }`}
                          >
                            {k.type}
                          </span>
                          {k.comment && (
                            <span className="text-xs text-muted truncate">({k.comment})</span>
                          )}
                        </div>

                        {/* Fingerprint */}
                        {k.fingerprint && (
                          <div className="mt-1 font-mono text-[11px] text-faint">
                            {k.fingerprint}
                          </div>
                        )}

                        {/* File path */}
                        <div className="mt-1 font-mono text-[10px] text-dim truncate">
                          {k.privateKeyPath || k.publicKeyPath}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex shrink-0 items-center gap-2">
                        {/* Select for session form (if callback provided) */}
                        {onSelectKey && k.privateKeyPath && (
                          <button
                            type="button"
                            onClick={() => {
                              onSelectKey(k.privateKeyPath);
                              onClose();
                            }}
                            className="rounded-lg bg-azure px-2.5 py-1 text-xs font-semibold text-white hover:bg-azure-hover"
                          >
                            Pilih Kunci Ini
                          </button>
                        )}

                        {/* Copy Public Key Button */}
                        <button
                          type="button"
                          onClick={() => void handleCopyPub(k)}
                          title={t('sshKey.copyPub')}
                          className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs transition ${
                            isCopied
                              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                              : 'border-line/60 bg-surface/70 text-dim hover:border-azure hover:text-azure'
                          }`}
                        >
                          <span>{isCopied ? '✓' : '📋'}</span>
                          <span>{isCopied ? t('sshKey.copiedPub') : t('sshKey.copyPub')}</span>
                        </button>

                        {/* Install to Active Remote Server */}
                        {activeSessionId && k.publicKeyContent && (
                          <button
                            type="button"
                            disabled={isInstalling}
                            onClick={() => void handleInstallToRemote(k)}
                            title={`Pasang kunci ini ke server ${activeSessionHost || ''}`}
                            className="flex items-center gap-1.5 rounded-lg border border-azure/40 bg-azure/10 px-2.5 py-1 text-xs font-semibold text-azure hover:bg-azure/20 disabled:opacity-40 transition"
                          >
                            <span>🚀</span>
                            <span>{isInstalling ? t('sshKey.installing') : t('sshKey.install')}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
