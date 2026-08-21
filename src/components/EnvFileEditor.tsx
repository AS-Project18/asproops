import { useEffect, useState } from 'react';
import type { ProjectProfile } from '../shared/types';
import { useI18n } from '../i18n';

/**
 * Editor .env terstruktur — beda dari "Environment variables" di form
 * Project (itu variabel yang di-export ASProOps sendiri sebelum langkah
 * deploy, lihat deploy.ts), ini menyunting berkas .env SUNGGUHAN di root
 * project yang dibaca langsung oleh Laravel/CodeIgniter 4 saat runtime.
 *
 * Baris komentar/kosong di .env dipertahankan verbatim (kind:'raw') supaya
 * tidak hilang saat disimpan ulang — cuma baris KEY=VALUE yang ditampilkan
 * sebagai tabel yang bisa disunting.
 */

interface EnvLine {
  id: string;
  kind: 'pair' | 'raw';
  key: string;
  value: string;
  raw: string;
}

const ENV_PAIR_RE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

function parseEnvContent(content: string): EnvLine[] {
  if (!content) return [];
  return content
    .replace(/\n+$/, '')
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      const match = !trimmed.startsWith('#') ? line.match(ENV_PAIR_RE) : null;
      if (match) {
        let value = match[2];
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        return { id: crypto.randomUUID(), kind: 'pair' as const, key: match[1], value, raw: '' };
      }
      return { id: crypto.randomUUID(), kind: 'raw' as const, key: '', value: '', raw: line };
    });
}

/** Bungkus nilai dengan tanda kutip kalau mengandung spasi/karakter yang bisa memecah parsing .env, biarkan polos kalau tidak. */
function serializeEnvValue(value: string): string {
  if (value === '' || /[\s#"'\\]/.test(value)) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return value;
}

function serializeEnvLines(lines: EnvLine[]): string {
  if (lines.length === 0) return '';
  return lines.map((l) => (l.kind === 'pair' ? `${l.key}=${serializeEnvValue(l.value)}` : l.raw)).join('\n') + '\n';
}

interface EnvFileEditorProps {
  sessionId: string;
  project: ProjectProfile;
  onClose: () => void;
}

export function EnvFileEditor({ sessionId, project, onClose }: EnvFileEditorProps) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lines, setLines] = useState<EnvLine[]>([]);
  const [reveal, setReveal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const result = await window.ssh.env.read(sessionId, project.path);
        setLines(parseEnvContent(result.content));
      } catch (err) {
        setLoadError((err as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [sessionId, project.path]);

  const pairLines = lines.filter((l) => l.kind === 'pair');

  const updateKey = (id: string, key: string) => {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, key } : l)));
  };
  const updateValue = (id: string, value: string) => {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, value } : l)));
  };
  const removeLine = (id: string) => {
    setLines((prev) => prev.filter((l) => l.id !== id));
  };
  const addLine = () => {
    setLines((prev) => [...prev, { id: crypto.randomUUID(), kind: 'pair', key: '', value: '', raw: '' }]);
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const cleaned = lines
        .filter((l) => l.kind !== 'pair' || l.key.trim())
        .map((l) => (l.kind === 'pair' ? { ...l, key: l.key.trim() } : l));
      const content = serializeEnvLines(cleaned);
      await window.ssh.env.write(sessionId, project.path, content);
      setLines(cleaned);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg border border-line bg-raised p-6">
        <div className="flex items-center justify-between">
          <h2 className="break-all text-sm font-semibold text-fg">
            {t('envfile.title', { name: project.name })}
          </h2>
          <button
            onClick={onClose}
            className="shrink-0 rounded px-1.5 py-1 text-faint hover:bg-line hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
          >
            ✕
          </button>
        </div>
        <p className="mt-1 text-[11px] text-faint">{t('envfile.subtitle')}</p>

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <div className="aspro-local-empty">{t('sftp.loading')}</div>
          ) : loadError ? (
            <div className="aspro-local-empty">
              <strong className="mb-1 block text-dim">{t('envfile.loadFailed')}</strong>
              <span>{loadError}</span>
            </div>
          ) : (
            <>
              {pairLines.length > 0 && (
                <div className="mb-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setReveal((v) => !v)}
                    className="text-[11px] text-azure hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
                  >
                    {reveal ? t('envfile.hideValues') : t('envfile.showValues')}
                  </button>
                </div>
              )}

              {pairLines.length === 0 ? (
                <div className="aspro-local-empty">{t('envfile.empty')}</div>
              ) : (
                <div className="space-y-2">
                  {pairLines.map((line) => (
                    <div key={line.id} className="flex items-center gap-2">
                      <input
                        value={line.key}
                        onChange={(e) => updateKey(line.id, e.target.value)}
                        spellCheck={false}
                        placeholder="KEY"
                        className="aspro-input w-2/5 px-2 py-1.5 font-mono text-xs text-fg placeholder-faint focus:border-azure focus:outline-none"
                      />
                      <input
                        value={line.value}
                        onChange={(e) => updateValue(line.id, e.target.value)}
                        spellCheck={false}
                        type={reveal ? 'text' : 'password'}
                        placeholder={t('envfile.valuePlaceholder')}
                        className="aspro-input w-3/5 px-2 py-1.5 font-mono text-xs text-fg placeholder-faint focus:border-azure focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => removeLine(line.id)}
                        className="shrink-0 rounded px-1.5 py-1 text-faint hover:bg-line hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <button
                type="button"
                onClick={addLine}
                className="mt-3 text-xs text-azure hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
              >
                {t('envfile.addVar')}
              </button>
            </>
          )}
        </div>

        {saveError && <p className="mt-3 shrink-0 text-xs text-coral">{saveError}</p>}

        <div className="mt-5 flex shrink-0 justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-4 py-2 text-sm text-dim hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
          >
            {t('project.cancel')}
          </button>
          <button
            type="button"
            disabled={loading || saving || !!loadError}
            onClick={() => void save()}
            className="aspro-button aspro-button-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saved ? '✓' : t('project.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
