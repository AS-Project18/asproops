import type { LocalTerminalProfile } from '../shared/types';
import { useI18n } from '../i18n';

interface LocalTerminalPanelProps {
  profiles: LocalTerminalProfile[];
  loading: boolean;
  onOpen: (profile: LocalTerminalProfile) => void;
  onRefresh: () => void;
}

function iconFor(profile: LocalTerminalProfile): string {
  if (profile.kind === 'wsl') return '⌁';
  if (profile.id === 'cmd') return 'C:\\';
  return '>_';
}

export function LocalTerminalPanel({
  profiles,
  loading,
  onOpen,
  onRefresh,
}: LocalTerminalPanelProps) {
  const { t } = useI18n();
  return (
    <section className="aspro-local-panel">
      <div className="aspro-local-title">
        <div>
          <span>{t('local.title')}</span>
          <small>{t('local.subtitle')}</small>
        </div>
        <button onClick={onRefresh} title={t('local.refresh')}>⟳</button>
      </div>

      {loading ? (
        <div className="aspro-local-empty">{t('local.detecting')}</div>
      ) : profiles.length === 0 ? (
        <div className="aspro-local-empty">
          {t('local.none')}
        </div>
      ) : (
        <div className="aspro-local-list">
          {profiles.map((profile) => (
            <button
              key={profile.id}
              className="aspro-local-row"
              onClick={() => onOpen(profile)}
            >
              <span className={`aspro-local-icon ${profile.kind}`}>{iconFor(profile)}</span>
              <span className="min-w-0 flex-1 text-left">
                <strong>{profile.kind === 'wsl' ? `WSL · ${profile.name}` : profile.name}</strong>
                <small>{profile.detail}</small>
              </span>
              <span className="aspro-local-open">＋</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
