import { useEffect, useState, type FormEvent } from 'react';
import { useI18n, type AppLanguage } from '../i18n';
import type { SshPreferences } from '../../electron/store/preferences';

interface SettingsDialogProps {
  onClose: () => void;
}

const roadmap = [
  ['settings.terminal', 'settings.terminalDesc', '>_'],
  ['settings.sftp', 'settings.sftpDesc', '□'],
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
            <div className="aspro-settings-section-heading">
              <span>◇</span>
              <div>
                <strong>{t('applock.settingsTitle')}</strong>
                <small>{t('applock.settingsDesc')}</small>
              </div>
            </div>
            <AppLockSettings />
          </section>

          <section className="aspro-settings-section">
            <div className="aspro-settings-section-heading">
              <span>⌁</span>
              <div>
                <strong>{t('settings.ssh')}</strong>
                <small>{t('settings.sshDesc')}</small>
              </div>
            </div>
            <SshSettings />
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

type LockMode = 'view' | 'setup' | 'change' | 'disable';

function AppLockSettings() {
  const { t } = useI18n();
  const [status, setStatus] = useState<{ enabled: boolean; locked: boolean } | null>(null);
  const [mode, setMode] = useState<LockMode>('view');
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void window.ssh.appLock.status().then(setStatus);
  }, []);

  const resetForm = () => {
    setMode('view');
    setCurrentPin('');
    setNewPin('');
    setConfirmPin('');
    setError(null);
  };

  const validateNewPin = (): boolean => {
    if (newPin.length < 4) {
      setError(t('applock.pinTooShort'));
      return false;
    }
    if (newPin !== confirmPin) {
      setError(t('applock.pinMismatch'));
      return false;
    }
    return true;
  };

  const submitSetup = async (event: FormEvent) => {
    event.preventDefault();
    if (!validateNewPin()) return;
    setBusy(true);
    const next = await window.ssh.appLock.setup(newPin);
    setBusy(false);
    setStatus(next);
    resetForm();
  };

  const submitChange = async (event: FormEvent) => {
    event.preventDefault();
    if (!validateNewPin()) return;
    setBusy(true);
    const result = await window.ssh.appLock.changePin(currentPin, newPin);
    setBusy(false);
    if (!result.ok) {
      setError(t('applock.wrongPin'));
      return;
    }
    setStatus(await window.ssh.appLock.status());
    resetForm();
  };

  const submitDisable = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const result = await window.ssh.appLock.disable(currentPin);
    setBusy(false);
    if (!result.ok) {
      setError(t('applock.wrongPin'));
      return;
    }
    setStatus(await window.ssh.appLock.status());
    resetForm();
  };

  if (!status) return null;

  if (mode === 'view') {
    return (
      <div className="aspro-setting-row">
        <div>
          <strong>{t('applock.settingsTitle')}</strong>
          <small>{status.enabled ? t('applock.statusEnabled') : t('applock.statusDisabled')}</small>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {status.enabled ? (
            <>
              <button
                type="button"
                onClick={() => setMode('change')}
                className="aspro-button aspro-button-secondary compact"
              >
                {t('applock.changePin')}
              </button>
              <button
                type="button"
                onClick={() => setMode('disable')}
                className="aspro-button aspro-button-danger compact"
              >
                {t('applock.disable')}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setMode('setup')}
              className="aspro-button aspro-button-primary compact"
            >
              {t('applock.enable')}
            </button>
          )}
        </div>
      </div>
    );
  }

  const title =
    mode === 'setup'
      ? t('applock.setupTitle')
      : mode === 'change'
        ? t('applock.changeTitle')
        : t('applock.disableTitle');

  const submit = mode === 'setup' ? submitSetup : mode === 'change' ? submitChange : submitDisable;

  return (
    <form onSubmit={(e) => void submit(e)} className="aspro-setting-row">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <strong>{title}</strong>
        {mode !== 'setup' && (
          <input
            type="password"
            autoFocus
            placeholder={t('applock.currentPin')}
            value={currentPin}
            onChange={(e) => setCurrentPin(e.target.value)}
            className="aspro-input w-full px-3 py-2 text-sm text-fg focus:border-azure focus:outline-none"
          />
        )}
        {mode !== 'disable' && (
          <>
            <input
              type="password"
              autoFocus={mode === 'setup'}
              placeholder={t('applock.newPin')}
              value={newPin}
              onChange={(e) => setNewPin(e.target.value)}
              className="aspro-input w-full px-3 py-2 text-sm text-fg focus:border-azure focus:outline-none"
            />
            <input
              type="password"
              placeholder={t('applock.confirmPin')}
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value)}
              className="aspro-input w-full px-3 py-2 text-sm text-fg focus:border-azure focus:outline-none"
            />
          </>
        )}
        {error && <p className="text-xs text-coral">{error}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={resetForm}
          className="aspro-button aspro-button-secondary compact"
        >
          {t('applock.cancel')}
        </button>
        <button
          type="submit"
          disabled={busy}
          className={`aspro-button compact ${
            mode === 'disable' ? 'aspro-button-danger' : 'aspro-button-primary'
          }`}
        >
          {mode === 'disable' ? t('applock.disable') : t('applock.save')}
        </button>
      </div>
    </form>
  );
}

function SshSettings() {
  const { t } = useI18n();
  const [prefs, setPrefs] = useState<SshPreferences | null>(null);

  useEffect(() => {
    void window.ssh.settings.sshGet().then(setPrefs);
  }, []);

  if (!prefs) return null;

  const update = (patch: Partial<SshPreferences>) => {
    void window.ssh.settings.sshUpdate(patch).then(setPrefs);
  };

  return (
    <>
      <div className="aspro-setting-row">
        <div>
          <strong>{t('settings.sshTimeout')}</strong>
          <small>{t('settings.sshTimeoutDesc')}</small>
        </div>
        <NumberField
          value={prefs.timeoutMs / 1000}
          min={3}
          max={120}
          onCommit={(seconds) => update({ timeoutMs: seconds * 1000 })}
        />
      </div>

      <div className="aspro-setting-row">
        <div>
          <strong>{t('settings.sshKeepalive')}</strong>
          <small>{t('settings.sshKeepaliveDesc')}</small>
        </div>
        <NumberField
          value={prefs.keepaliveIntervalMs / 1000}
          min={5}
          max={120}
          onCommit={(seconds) => update({ keepaliveIntervalMs: seconds * 1000 })}
        />
      </div>

      <div className="aspro-setting-row">
        <div>
          <strong>{t('settings.sshAutoReconnect')}</strong>
          <small>{t('settings.sshAutoReconnectDesc')}</small>
        </div>
        <label className="aspro-hidden-toggle shrink-0">
          <input
            type="checkbox"
            checked={prefs.autoReconnect}
            onChange={(e) => update({ autoReconnect: e.target.checked })}
          />
          <span>{t(prefs.autoReconnect ? 'applock.statusEnabled' : 'applock.statusDisabled')}</span>
        </label>
      </div>

      <div className="aspro-setting-row">
        <div>
          <strong>{t('settings.sshResetTitle')}</strong>
          <small>{t('settings.sshResetDesc')}</small>
        </div>
        <button
          type="button"
          onClick={() => void window.ssh.settings.sshReset().then(setPrefs)}
          className="aspro-button aspro-button-secondary compact shrink-0"
        >
          {t('settings.sshReset')}
        </button>
      </div>
    </>
  );
}

function NumberField({
  value,
  min,
  max,
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
}) {
  const [local, setLocal] = useState(String(value));

  useEffect(() => setLocal(String(value)), [value]);

  const commit = () => {
    const parsed = Math.round(Number(local));
    const clamped = Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : value;
    setLocal(String(clamped));
    if (clamped !== value) onCommit(clamped);
  };

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          commit();
          (e.target as HTMLInputElement).blur();
        }}
        className="aspro-input w-16 px-2 py-1.5 text-right text-sm text-fg focus:border-azure focus:outline-none"
      />
      <span className="text-xs text-faint">s</span>
    </div>
  );
}
