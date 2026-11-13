import { useState, useMemo, type FormEvent } from 'react';
import type { CommandSnippet } from '../shared/types';
import { useI18n } from '../i18n';
import { extractSnippetVariables, interpolateSnippet } from '../lib/snippetUtils';

interface SnippetVariableModalProps {
  snippet: CommandSnippet;
  onExecute: (interpolatedCommand: string, enter: boolean) => void;
  onClose: () => void;
}

export function SnippetVariableModal({ snippet, onExecute, onClose }: SnippetVariableModalProps) {
  const { t } = useI18n();
  const variables = useMemo(() => extractSnippetVariables(snippet.command), [snippet.command]);

  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const v of variables) init[v] = '';
    return init;
  });

  const preview = useMemo(() => interpolateSnippet(snippet.command, values), [snippet.command, values]);

  const handleSubmit = (enter: boolean) => {
    onExecute(preview, enter);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[160] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-xl border border-line bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="snippet-variable-title"
      >
        <header className="flex items-center justify-between border-b border-line/60 bg-raised px-4 py-3">
          <div>
            <h3 id="snippet-variable-title" className="flex items-center gap-2 text-sm font-bold text-fg">
              <span>⚡</span>
              <span>{t('snippets.variableModalTitle', { name: snippet.name })}</span>
            </h3>
            <p className="text-[11px] text-muted">{snippet.description || t('snippets.variableModalSubtitle')}</p>
          </div>
          <button type="button" onClick={onClose} className="text-faint hover:text-fg text-sm">
            ✕
          </button>
        </header>

        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            handleSubmit(true);
          }}
          className="p-4"
        >
          {/* Form inputs for each variable */}
          <div className="space-y-3">
            {variables.map((variable, idx) => (
              <div key={variable}>
                <label className="mb-1 block text-xs font-medium text-dim">
                  <span className="font-mono text-azure">{`{{${variable}}}`}</span>
                </label>
                <input
                  type="text"
                  autoFocus={idx === 0}
                  value={values[variable] ?? ''}
                  onChange={(e) => setValues((prev) => ({ ...prev, [variable]: e.target.value }))}
                  placeholder={t('snippets.variablePlaceholder', { name: variable })}
                  className="aspro-input w-full px-3 py-1.5 font-mono text-sm"
                  required
                />
              </div>
            ))}
          </div>

          {/* Live Preview */}
          <div className="mt-4 rounded-lg border border-line/50 bg-abyss p-3">
            <span className="mb-1 block text-[10px] font-mono uppercase tracking-wider text-faint">
              {t('snippets.livePreview')}
            </span>
            <div className="break-all font-mono text-xs text-mint">
              $ {preview}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="aspro-button aspro-button-secondary compact"
            >
              {t('settings.close')}
            </button>
            <button
              type="button"
              onClick={() => handleSubmit(false)}
              className="aspro-button aspro-button-secondary compact gap-1.5"
              title={t('snippets.insertTooltip')}
            >
              <span>📋</span>
              <span>{t('snippets.insert')}</span>
            </button>
            <button
              type="submit"
              className="aspro-button aspro-button-primary compact gap-1.5"
            >
              <span>▶</span>
              <span>{t('snippets.execute')}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
