import type { LocalProjectContextResult } from '../shared/types';
import { useI18n } from '../i18n';

interface ProjectContextDialogProps {
  projectName: string;
  context: LocalProjectContextResult | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onRefresh: () => void;
}

export function ProjectContextDialog({
  projectName,
  context,
  loading,
  error,
  onClose,
  onRefresh,
}: ProjectContextDialogProps) {
  const { t } = useI18n();

  const copyContext = () => {
    if (!context) return;
    window.ssh.clipboard.writeText(context.handoffText);
  };

  return (
    <div
      className="aspro-context-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="aspro-context-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="aspro-context-title"
      >
        <header className="aspro-context-header">
          <div className="min-w-0">
            <strong id="aspro-context-title">{t('local.contextTitle')}</strong>
            <span title={projectName}>{projectName}</span>
          </div>
          <button
            type="button"
            className="aspro-local-icon-action"
            onClick={onClose}
            aria-label={t('local.contextClose')}
            title={t('local.contextClose')}
          >
            ×
          </button>
        </header>

        <div className="aspro-context-body">
          {loading ? (
            <div className="aspro-context-state">{t('local.contextLoading')}</div>
          ) : error ? (
            <div className="aspro-context-error">{error}</div>
          ) : context ? (
            <>
              <div className="aspro-context-summary">
                <div>
                  <span>{t('local.contextGit')}</span>
                  {context.git.available && context.git.isRepository ? (
                    <div className="aspro-context-chips">
                      <i>{context.git.branch ?? 'Git'}</i>
                      {context.git.head ? <i>{context.git.head}</i> : null}
                      <i className={context.git.clean ? 'ok' : 'warn'}>
                        {context.git.clean
                          ? t('local.contextClean')
                          : t('local.contextChanged', {
                              count: context.git.changes.length,
                            })}
                      </i>
                    </div>
                  ) : (
                    <small>{t('local.contextNoGit')}</small>
                  )}
                </div>

                <div>
                  <span>{t('local.contextDocs')}</span>
                  {context.files.length > 0 ? (
                    <div className="aspro-context-docs">
                      {context.files.map((file) => (
                        <i key={file.path} title={file.path}>
                          {file.path}
                          {file.truncated ? '…' : ''}
                        </i>
                      ))}
                    </div>
                  ) : (
                    <small>{t('local.contextNoDocs')}</small>
                  )}
                </div>
              </div>

              <textarea
                className="aspro-context-preview"
                readOnly
                spellCheck={false}
                value={context.handoffText}
                aria-label={t('local.contextTitle')}
              />

              <div className="aspro-context-warning">{t('local.contextReview')}</div>
            </>
          ) : null}
        </div>

        <footer className="aspro-context-footer">
          <button type="button" onClick={onClose}>
            {t('local.contextClose')}
          </button>
          <button type="button" onClick={onRefresh} disabled={loading}>
            ↻ {t('local.contextRefresh')}
          </button>
          <button
            type="button"
            className="primary"
            onClick={copyContext}
            disabled={loading || !context}
          >
            ⧉ {t('local.contextCopy')}
          </button>
        </footer>
      </section>
    </div>
  );
}
