import { useEffect, useState } from 'react';
import type { DeployHistoryEntry, ProjectProfile } from '../shared/types';
import { formatLogTimestamp } from '../lib/format';
import { useI18n } from '../i18n';

/**
 * Modal riwayat deploy per project — daftar run terakhir (deploy maupun
 * rollback) dengan status, commit, dan tombol rollback ke entri yang punya
 * commit git. Reuse DeployView untuk menjalankan rollback-nya sendiri (lewat
 * onRollback -> workspace tab baru), modal ini murni daftar + pemicu.
 */

interface DeployHistoryModalProps {
  project: ProjectProfile;
  templateName: string;
  onRollback: (entryId: string) => void;
  onClose: () => void;
}

function statusIcon(entry: DeployHistoryEntry): { icon: string; className: string } {
  if (entry.success === undefined) return { icon: '●', className: 'text-azure' };
  return entry.success ? { icon: '✓', className: 'text-mint' } : { icon: '✗', className: 'text-coral' };
}

export function DeployHistoryModal({ project, templateName, onRollback, onClose }: DeployHistoryModalProps) {
  const { t, language } = useI18n();
  const locale = language === 'en' ? 'en-US' : 'id-ID';
  const [entries, setEntries] = useState<DeployHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingRollback, setPendingRollback] = useState<DeployHistoryEntry | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      setEntries(await window.ssh.deploy.listHistory(project.id));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    return window.ssh.deploy.onHistoryChanged((projectId) => {
      if (projectId === project.id) void refresh();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg border border-line bg-raised p-6">
        <div className="flex items-center justify-between">
          <h2 className="break-all text-sm font-semibold text-fg">
            {t('deploy.historyTitle', { name: project.name })}
          </h2>
          <button
            onClick={onClose}
            className="shrink-0 rounded px-1.5 py-1 text-faint hover:bg-line hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <div className="aspro-local-empty">{t('sftp.loading')}</div>
          ) : entries.length === 0 ? (
            <div className="aspro-local-empty">{t('deploy.historyEmpty')}</div>
          ) : (
            <div className="space-y-2">
              {entries.map((entry) => {
                const status = statusIcon(entry);
                return (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between gap-3 rounded border border-line px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-xs">
                        <span className={status.className}>{status.icon}</span>
                        <span className="text-fg">{formatLogTimestamp(entry.startedAt, locale)}</span>
                        {entry.isRollback && (
                          <span className="rounded border border-line px-1 py-0.5 text-[10px] text-faint">
                            {t('deploy.historyRollbackTag')}
                          </span>
                        )}
                      </div>
                      {entry.commitHash && (
                        <div className="mt-0.5 truncate font-mono text-[11px] text-muted">
                          {entry.commitHash}
                        </div>
                      )}
                      {!entry.success && entry.message && (
                        <div className="mt-0.5 truncate text-[11px] text-coral" title={entry.message}>
                          {entry.message}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => setPendingRollback(entry)}
                      disabled={!entry.commitHash}
                      title={
                        entry.commitHash
                          ? t('deploy.historyRollback')
                          : t('deploy.historyNoCommit')
                      }
                      className="shrink-0 rounded border border-line px-2 py-1 text-[11px] text-dim hover:border-azure hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-azure disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      ↩ {t('deploy.historyRollback')}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {pendingRollback && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-6">
          <div className="w-full max-w-sm rounded-lg border border-line bg-raised p-6">
            <h2 className="text-sm font-semibold text-fg">{t('deploy.rollbackConfirmTitle')}</h2>
            <p className="mt-2 text-xs text-muted">
              {t('deploy.rollbackConfirmDesc', {
                commit: pendingRollback.commitHash ?? '',
                template: templateName,
              })}
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => setPendingRollback(null)}
                className="rounded px-4 py-2 text-sm text-dim hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-azure"
              >
                {t('project.cancel')}
              </button>
              <button
                onClick={() => {
                  onRollback(pendingRollback.id);
                  setPendingRollback(null);
                  onClose();
                }}
                className="aspro-button aspro-button-primary"
              >
                {t('deploy.historyRollback')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
