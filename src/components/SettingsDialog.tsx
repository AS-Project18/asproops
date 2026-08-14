import { useI18n, type AppLanguage } from '../i18n';

interface SettingsDialogProps {
  onClose: () => void;
}

const roadmap = [
  ['settings.appearance', 'settings.appearanceDesc', '◐'],
  ['settings.terminal', 'settings.terminalDesc', '>_'],
  ['settings.ssh', 'settings.sshDesc', '⌁'],
  ['settings.sftp', 'settings.sftpDesc', '□'],
  ['settings.monitoring', 'settings.monitoringDesc', '⌁'],
  ['settings.security', 'settings.securityDesc', '◇'],
  ['settings.updates', 'settings.updatesDesc', '↻'],
  ['settings.advanced', 'settings.advancedDesc', '⚙'],
] as const;

export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const { language, setLanguage, t } = useI18n();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" role="presentation">
      <section
        className="aspro-settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <header className="aspro-settings-header">
          <div>
            <h2 id="settings-title">{t('settings.title')}</h2>
            <p>{t('settings.subtitle')}</p>
          </div>
          <button onClick={onClose} aria-label={t('settings.close')}>×</button>
        </header>

        <div className="aspro-settings-body">
          <section className="aspro-settings-section">
            <div className="aspro-settings-section-heading">
              <span>◎</span>
              <div>
                <strong>{t('settings.general')}</strong>
                <small>{t('settings.languageHelp')}</small>
              </div>
            </div>

            <div className="aspro-setting-row">
              <div>
                <strong>{t('settings.language')}</strong>
                <small>{t('settings.languageHelp')}</small>
              </div>

              <div className="aspro-language-switch" role="radiogroup">
                <LanguageButton
                  language="id"
                  active={language === 'id'}
                  label={t('settings.indonesian')}
                  onClick={() => setLanguage('id')}
                />
                <LanguageButton
                  language="en"
                  active={language === 'en'}
                  label={t('settings.english')}
                  onClick={() => setLanguage('en')}
                />
              </div>
            </div>
          </section>

          <section className="aspro-settings-section">
            <div className="aspro-settings-roadmap-title">
              <div>
                <strong>{t('settings.roadmapTitle')}</strong>
                <small>{t('settings.roadmapDesc')}</small>
              </div>
            </div>

            <div className="aspro-settings-roadmap">
              {roadmap.map(([title, description, icon]) => (
                <article key={title} className="aspro-settings-roadmap-item">
                  <span className="aspro-settings-roadmap-icon">{icon}</span>
                  <div>
                    <strong>{t(title)}</strong>
                    <small>{t(description)}</small>
                  </div>
                  <span className="aspro-planned-badge">{t('settings.planned')}</span>
                </article>
              ))}
            </div>
          </section>
        </div>

        <footer className="aspro-settings-footer">
          <button onClick={onClose} className="aspro-button aspro-button-primary">
            {t('settings.close')}
          </button>
        </footer>
      </section>
    </div>
  );
}

function LanguageButton({
  language,
  label,
  active,
  onClick,
}: {
  language: AppLanguage;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      className={active ? 'active' : ''}
      onClick={onClick}
    >
      <span>{language === 'id' ? 'ID' : 'EN'}</span>
      {label}
    </button>
  );
}
