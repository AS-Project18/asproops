import { useState, type FormEvent } from 'react';
import type { CommandSnippet, CommandSnippetCreateInput, SnippetPlatform } from '../shared/types';
import { useI18n } from '../i18n';

interface SnippetFormModalProps {
  existing?: CommandSnippet | null;
  onSave: (input: CommandSnippetCreateInput, existingId?: string) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
  onClose: () => void;
}

const POPULAR_CATEGORIES = ['Docker', 'Systemd', 'Network', 'System', 'Git', 'Nginx', 'Windows', 'PowerShell', 'Custom'];

export function SnippetFormModal({ existing, onSave, onDelete, onClose }: SnippetFormModalProps) {
  const { t } = useI18n();
  const [name, setName] = useState(existing?.name ?? '');
  const [command, setCommand] = useState(existing?.command ?? '');
  const [category, setCategory] = useState(existing?.category ?? 'Docker');
  const [platform, setPlatform] = useState<SnippetPlatform>(existing?.platform ?? 'all');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !command.trim()) return;

    setBusy(true);
    setError(null);
    try {
      await onSave(
        {
          name: name.trim(),
          command: command.trim(),
          category: category.trim() || 'Custom',
          platform,
          description: description.trim() || undefined,
        },
        existing?.id,
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!existing || !onDelete) return;
    setBusy(true);
    try {
      await onDelete(existing.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[160] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-line bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="snippet-form-title"
      >
        <header className="flex items-center justify-between border-b border-line/60 bg-raised px-4 py-3">
          <h3 id="snippet-form-title" className="flex items-center gap-2 text-sm font-bold text-fg">
            <span>⚡</span>
            <span>{existing ? t('snippets.editSnippet') : t('snippets.addSnippet')}</span>
          </h3>
          <button type="button" onClick={onClose} className="text-faint hover:text-fg text-sm">
            ✕
          </button>
        </header>

        <form onSubmit={handleSubmit} className="p-4 space-y-3.5">
          {error && (
            <div className="rounded-lg border border-coral/40 bg-coral/10 p-2.5 text-xs text-coral">
              {error}
            </div>
          )}

          {/* Nama Snippet */}
          <div>
            <label className="mb-1 block text-xs font-medium text-dim">
              {t('snippets.formName')}
            </label>
            <input
              type="text"
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="mis. Restart Web Service"
              className="aspro-input w-full px-3 py-1.5 text-sm"
            />
          </div>

          {/* Kategori */}
          <div>
            <label className="mb-1 block text-xs font-medium text-dim">
              {t('snippets.formCategory')}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                required
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="mis. Docker, Systemd, Nginx"
                className="aspro-input flex-1 px-3 py-1.5 text-sm"
              />
              <select
                value={POPULAR_CATEGORIES.includes(category) ? category : ''}
                onChange={(e) => e.target.value && setCategory(e.target.value)}
                className="aspro-input w-36 px-2 py-1.5 text-xs"
              >
                <option value="">{t('snippets.quickCategory')}</option>
                {POPULAR_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Target Sistem Operasi / Platform */}
          <div>
            <label className="mb-1 block text-xs font-medium text-dim">
              {t('snippets.formPlatform')}
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setPlatform('all')}
                className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors text-center ${
                  platform === 'all'
                    ? 'border-azure bg-azure/15 text-azure font-bold'
                    : 'border-line bg-raised text-muted hover:border-line hover:text-fg'
                }`}
              >
                🌐 {t('snippets.platformAll')}
              </button>
              <button
                type="button"
                onClick={() => setPlatform('linux')}
                className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors text-center ${
                  platform === 'linux'
                    ? 'border-azure bg-azure/15 text-azure font-bold'
                    : 'border-line bg-raised text-muted hover:border-line hover:text-fg'
                }`}
              >
                🐧 {t('snippets.platformLinux')}
              </button>
              <button
                type="button"
                onClick={() => setPlatform('windows')}
                className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors text-center ${
                  platform === 'windows'
                    ? 'border-azure bg-azure/15 text-azure font-bold'
                    : 'border-line bg-raised text-muted hover:border-line hover:text-fg'
                }`}
              >
                🪟 {t('snippets.platformWindows')}
              </button>
            </div>
          </div>

          {/* Perintah / Command */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-xs font-medium text-dim">{t('snippets.formCommand')}</label>
              <span className="text-[10px] text-faint font-mono">
                {t('snippets.variableHint')}
              </span>
            </div>
            <textarea
              required
              rows={3}
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="mis. docker compose restart {{service}}"
              className="aspro-input w-full px-3 py-2 font-mono text-xs leading-relaxed"
            />
          </div>

          {/* Deskripsi (opsional) */}
          <div>
            <label className="mb-1 block text-xs font-medium text-dim">
              {t('snippets.formDescription')}
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Keterangan singkat fungsi perintah ini"
              className="aspro-input w-full px-3 py-1.5 text-sm"
            />
          </div>

          {/* Footer actions */}
          <div className="mt-5 flex items-center justify-between pt-2 border-t border-line/30">
            <div>
              {existing && onDelete && (
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  disabled={busy}
                  className="aspro-button aspro-button-danger compact"
                >
                  {t('applock.disable')}
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="aspro-button aspro-button-secondary compact"
              >
                {t('settings.close')}
              </button>
              <button
                type="submit"
                disabled={busy}
                className="aspro-button aspro-button-primary compact"
              >
                {busy ? t('settings.backupProcessing') : t('applock.save')}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
