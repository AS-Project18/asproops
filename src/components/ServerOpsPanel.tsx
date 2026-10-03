import { CronPanel } from './CronPanel';
import { DockerPanel } from './DockerPanel';
import { ServicesPanel } from './ServicesPanel';
import { useI18n } from '../i18n';

export type ServerOpsTab = 'docker' | 'cron' | 'services';

interface ServerOpsPanelProps {
  sessionId: string;
  activeTab: ServerOpsTab;
  onTabChange: (tab: ServerOpsTab) => void;
  focusService?: string | null;
  onOpenLogs: (sessionId: string, containerId: string, containerName: string) => void;
}

export function ServerOpsPanel({
  sessionId,
  activeTab,
  onTabChange,
  focusService,
  onOpenLogs,
}: ServerOpsPanelProps) {
  const { t } = useI18n();

  return (
    <section className="aspro-server-ops">
      <div className="aspro-left-mode-tabs aspro-server-ops-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'docker'}
          className={activeTab === 'docker' ? 'active' : ''}
          onClick={() => onTabChange('docker')}
        >
          {t('nav.docker')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'cron'}
          className={activeTab === 'cron' ? 'active' : ''}
          onClick={() => onTabChange('cron')}
        >
          {t('nav.cron')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'services'}
          className={activeTab === 'services' ? 'active' : ''}
          onClick={() => onTabChange('services')}
        >
          {t('nav.services')}
        </button>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div
          className={
            activeTab === 'docker'
              ? 'absolute inset-0'
              : 'pointer-events-none invisible absolute inset-0'
          }
        >
          <DockerPanel sessionId={sessionId} onOpenLogs={onOpenLogs} />
        </div>

        <div
          className={
            activeTab === 'cron'
              ? 'absolute inset-0'
              : 'pointer-events-none invisible absolute inset-0'
          }
        >
          <CronPanel sessionId={sessionId} />
        </div>

        <div
          className={
            activeTab === 'services'
              ? 'absolute inset-0'
              : 'pointer-events-none invisible absolute inset-0'
          }
        >
          <ServicesPanel sessionId={sessionId} focusService={focusService} />
        </div>
      </div>
    </section>
  );
}
