import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useI18n, type AppLanguage, type MessageKey } from '../i18n';
import {
  MAX_TERMINAL_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
  useTerminalPrefs,
  type CursorStyle,
  TERMINAL_THEMES,
  TERMINAL_FONT_PRESETS,
  resolveTerminalTheme,
} from '../terminalPrefs';
import { useWorkspacePrefs } from '../workspacePrefs';
import { DeployTemplatesSettings } from './DeployTemplatesSettings';
import type { SshPreferences, SftpPreferences, ConflictPolicy } from '../../electron/store/preferences';
import type { UpdateCheckResult, LocalTerminalProfile } from '../shared/types';

interface SettingsDialogProps {
  onClose: () => void;
}

type SettingsTab =
  | 'general'
  | 'terminal'
  | 'workspace'
  | 'ssh'
  | 'sftp'
  | 'security'
  | 'templates'
  | 'backup'
  | 'about';

interface TabItem {
  id: SettingsTab;
  icon: string;
  labelKey: MessageKey;
  descKey: MessageKey;
}

const TABS: TabItem[] = [
  { id: 'general', icon: '⚙️', labelKey: 'settings.tabGeneral', descKey: 'settings.languageHelp' },
  { id: 'terminal', icon: '🖥️', labelKey: 'settings.tabTerminal', descKey: 'settings.terminalDesc' },
  { id: 'workspace', icon: '💻', labelKey: 'settings.tabWorkspace', descKey: 'settings.wsDefaultShellDesc' },
  { id: 'ssh', icon: '⌁', labelKey: 'settings.tabSsh', descKey: 'settings.sshDesc' },
  { id: 'sftp', icon: '📁', labelKey: 'settings.tabSftp', descKey: 'settings.sftpDesc' },
  { id: 'security', icon: '🔒', labelKey: 'settings.tabSecurity', descKey: 'applock.settingsDesc' },
  { id: 'templates', icon: '🚀', labelKey: 'settings.tabTemplates', descKey: 'settings.templatesDesc' },
  { id: 'backup', icon: '💾', labelKey: 'settings.tabBackup', descKey: 'settings.backupDesc' },
  { id: 'about', icon: 'ℹ️', labelKey: 'settings.tabAbout', descKey: 'settings.aboutDesc' },
];

export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [search, setSearch] = useState('');

  const currentTabInfo = useMemo(() => {
    return TABS.find((tab) => tab.id === activeTab) ?? TABS[0];
  }, [activeTab]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" role="presentation">
      <section
        className="aspro-settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        {/* Header */}
        <header className="aspro-settings-header">
          <div>
            <h2 id="settings-title" className="flex items-center gap-2">
              <span>⚙</span>
              <span>{t('settings.title')}</span>
            </h2>
            <p>{t('settings.subtitle')}</p>
          </div>

          <div className="flex items-center gap-3">
            <div className="aspro-settings-search">
              <span className="text-muted text-xs">🔍</span>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('settings.searchPlaceholder')}
                aria-label={t('settings.searchPlaceholder')}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="text-faint hover:text-fg text-xs"
                >
                  ✕
                </button>
              )}
            </div>

            <button onClick={onClose} aria-label={t('settings.close')}>×</button>
          </div>
        </header>

        {/* Master-Detail Two Column Layout */}
        <div className="aspro-settings-layout">
          {/* Left Category Sidebar */}
          <nav className="aspro-settings-nav" aria-label="Kategori Pengaturan">
            {TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`aspro-settings-nav-item ${isActive ? 'active' : ''}`}
                >
                  <span className="aspro-settings-nav-icon">{tab.icon}</span>
                  <span className="truncate">{t(tab.labelKey)}</span>
                </button>
              );
            })}
          </nav>

          {/* Right Content Pane */}
          <main className="aspro-settings-content">
            <div className="mb-4 flex items-center justify-between border-b border-line/25 pb-3">
              <div className="flex items-center gap-2.5">
                <span className="text-xl">{currentTabInfo.icon}</span>
                <div>
                  <h3 className="text-sm font-bold text-fg">{t(currentTabInfo.labelKey)}</h3>
                  <p className="text-xs text-muted">{t(currentTabInfo.descKey)}</p>
                </div>
              </div>
            </div>

            <div className="aspro-settings-section">
              {activeTab === 'general' && <GeneralSettings />}
              {activeTab === 'terminal' && <TerminalSettings />}
              {activeTab === 'workspace' && <WorkspaceSettings />}
              {activeTab === 'ssh' && <SshSettings />}
              {activeTab === 'sftp' && <SftpSettings />}
              {activeTab === 'security' && <AppLockSettings />}
              {activeTab === 'templates' && <DeployTemplatesSettings />}
              {activeTab === 'backup' && <BackupSettings />}
              {activeTab === 'about' && <AboutSettings />}
            </div>
          </main>
        </div>

        {/* Footer */}
        <footer className="aspro-settings-footer">
          <button onClick={onClose} className="aspro-button aspro-button-primary compact">
            {t('settings.close')}
          </button>
        </footer>
      </section>
    </div>
  );
}

function GeneralSettings() {
  const { language, setLanguage, t } = useI18n();

  return (
    <>
      <div className="aspro-setting-row">
        <div>
          <strong>{t('settings.language')}</strong>
          <small>{t('settings.languageHelp')}</small>
        </div>

        <div className="aspro-language-switch shrink-0" role="radiogroup">
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
    </>
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

function TerminalLivePreview({
  fontFamily,
  fontSize,
  lineHeight,
  cursorStyle,
  cursorBlink,
  themeId,
}: {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  cursorStyle: CursorStyle;
  cursorBlink: boolean;
  themeId: string;
}) {
  const { t } = useI18n();
  const theme = resolveTerminalTheme(themeId);
  const activeFont = fontFamily || 'Cascadia Code, Consolas, monospace';

  return (
    <div className="mb-5 overflow-hidden rounded-lg border border-line/50 shadow-xl">
      <div className="flex items-center justify-between border-b border-line/30 bg-black/40 px-3 py-1.5 text-[11px] text-faint">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-coral/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-mint/70" />
          <span className="ml-2 font-mono text-[10px] text-muted">
            {t('settings.livePreview')}
          </span>
        </div>
        <span className="text-[10px] text-dim font-mono">{themeId.toUpperCase()}</span>
      </div>

      <div
        className="p-3 transition-colors duration-150"
        style={{
          backgroundColor: theme.background,
          color: theme.foreground,
          fontFamily: activeFont,
          fontSize: `${fontSize}px`,
          lineHeight: lineHeight || 1.25,
        }}
      >
        <div className="flex items-center gap-1.5">
          <span style={{ color: theme.green }}>user@asproops</span>
          <span style={{ color: theme.magenta }}>:</span>
          <span style={{ color: theme.blue }}>~/project</span>
          <span style={{ color: theme.cyan }}>$</span>
          <span className="ml-1 text-fg">docker ps --format "table {'{{.Names}}'}\t{'{{.Status}}'}"</span>
        </div>
        <div className="mt-1" style={{ color: theme.brightBlack }}>
          NAMES &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;STATUS
        </div>
        <div className="flex items-center gap-2">
          <span style={{ color: theme.yellow }}>web-gateway</span>
          <span style={{ color: theme.green }}>Up 4 days (healthy)</span>
        </div>
        <div className="flex items-center gap-2">
          <span style={{ color: theme.magenta }}>postgres-db</span>
          <span style={{ color: theme.green }}>Up 12 days (healthy)</span>
        </div>
        <div className="mt-1.5 flex items-center gap-1.5">
          <span style={{ color: theme.green }}>user@asproops</span>
          <span style={{ color: theme.magenta }}>:</span>
          <span style={{ color: theme.blue }}>~/project</span>
          <span style={{ color: theme.cyan }}>$</span>
          <span className="ml-1 text-fg">htop</span>
          <span
            className={`inline-block ${cursorBlink ? 'animate-pulse' : ''}`}
            style={{
              backgroundColor: cursorStyle === 'block' ? theme.cursor : 'transparent',
              color: theme.cursorAccent || theme.background,
              borderBottom: cursorStyle === 'underline' ? `2px solid ${theme.cursor}` : undefined,
              borderLeft: cursorStyle === 'bar' ? `2px solid ${theme.cursor}` : undefined,
              width: cursorStyle === 'bar' ? '2px' : '8px',
              height: cursorStyle === 'bar' ? `${fontSize}px` : `${fontSize * 1.1}px`,
              marginLeft: '2px',
            }}
          />
        </div>
      </div>
    </div>
  );
}

function TerminalSettings() {
  const { t } = useI18n();
  const { prefs, setPrefs, resetPrefs } = useTerminalPrefs();
  const [customFont, setCustomFont] = useState(prefs.fontFamily);

  useEffect(() => setCustomFont(prefs.fontFamily), [prefs.fontFamily]);

  const commitCustomFont = () => {
    if (customFont !== prefs.fontFamily) setPrefs({ fontFamily: customFont });
  };

  const isPresetFont = TERMINAL_FONT_PRESETS.some((p) => p.id === prefs.fontFamily);

  return (
    <>
      <TerminalLivePreview
        fontFamily={prefs.fontFamily}
        fontSize={prefs.fontSize}
        lineHeight={prefs.lineHeight}
        cursorStyle={prefs.cursorStyle}
        cursorBlink={prefs.cursorBlink}
        themeId={prefs.themeId}
      />

      {/* Terminal Theme */}
      <div className="aspro-setting-row">
        <div>
          <strong>{t('settings.terminalTheme')}</strong>
          <small>{t('settings.terminalThemeDesc')}</small>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <select
            value={prefs.themeId}
            onChange={(e) => setPrefs({ themeId: e.target.value })}
            className="aspro-input w-48 px-3 py-1.5 text-sm text-fg focus:border-azure focus:outline-none"
          >
            {TERMINAL_THEMES.map((theme) => (
              <option key={theme.id} value={theme.id}>
                {theme.name}
              </option>
            ))}
          </select>
          {(() => {
            const currentTheme = resolveTerminalTheme(prefs.themeId);
            return (
              <div
                className="flex h-7 items-center gap-1 rounded border border-line px-2 shadow-inner"
                style={{ backgroundColor: currentTheme.background }}
                title="Warna tema aktif"
              >
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: currentTheme.cursor }} />
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: currentTheme.cyan }} />
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: currentTheme.magenta }} />
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: currentTheme.green }} />
              </div>
            );
          })()}
        </div>
      </div>

      {/* Font Preset & Custom */}
      <div className="aspro-setting-row">
        <div>
          <strong>{t('settings.terminalFontPreset')}</strong>
          <small>{t('settings.terminalFontPresetDesc')}</small>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <select
            value={isPresetFont ? prefs.fontFamily : '__custom__'}
            onChange={(e) => {
              const val = e.target.value;
              if (val !== '__custom__') {
                setPrefs({ fontFamily: val });
                setCustomFont(val);
              }
            }}
            className="aspro-input w-52 px-3 py-1.5 text-sm text-fg focus:border-azure focus:outline-none"
          >
            {TERMINAL_FONT_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
            <option value="__custom__">Kustom / Lainnya…</option>
          </select>

          {(!isPresetFont || customFont !== '') && (
            <input
              type="text"
              value={customFont}
              onChange={(e) => setCustomFont(e.target.value)}
              onBlur={commitCustomFont}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  commitCustomFont();
                  (e.target as HTMLInputElement).blur();
                }
              }}
              placeholder={t('settings.terminalFontPlaceholder')}
              className="aspro-input w-52 px-3 py-1 text-xs text-fg focus:border-azure focus:outline-none"
              title="Nama font spesifik"
            />
          )}
        </div>
      </div>

      {/* Font Size */}
      <div className="aspro-setting-row">
        <div>
          <strong>{t('settings.terminalFontSize')}</strong>
          <small>{t('settings.terminalFontSizeDesc')}</small>
        </div>
        <NumberField
          value={prefs.fontSize}
          min={MIN_TERMINAL_FONT_SIZE}
          max={MAX_TERMINAL_FONT_SIZE}
          suffix="px"
          onCommit={(fontSize) => setPrefs({ fontSize })}
        />
      </div>

      {/* Line Height */}
      <div className="aspro-setting-row">
        <div>
          <strong>{t('settings.terminalLineHeight')}</strong>
          <small>{t('settings.terminalLineHeightDesc')}</small>
        </div>
        <div className="aspro-language-switch shrink-0" role="radiogroup">
          {[1.0, 1.15, 1.25, 1.4].map((lh) => (
            <button
              key={lh}
              type="button"
              className={prefs.lineHeight === lh ? 'active' : ''}
              onClick={() => setPrefs({ lineHeight: lh })}
            >
              {lh.toFixed(2)}
            </button>
          ))}
        </div>
      </div>

      {/* Cursor Shape */}
      <div className="aspro-setting-row">
        <div>
          <strong>{t('settings.terminalCursorStyle')}</strong>
        </div>
        <div className="aspro-language-switch shrink-0" role="radiogroup">
          <CursorStyleButton
            value="block"
            current={prefs.cursorStyle}
            label={t('settings.terminalCursorBlock')}
            onSelect={(cursorStyle) => setPrefs({ cursorStyle })}
          />
          <CursorStyleButton
            value="underline"
            current={prefs.cursorStyle}
            label={t('settings.terminalCursorUnderline')}
            onSelect={(cursorStyle) => setPrefs({ cursorStyle })}
          />
          <CursorStyleButton
            value="bar"
            current={prefs.cursorStyle}
            label={t('settings.terminalCursorBar')}
            onSelect={(cursorStyle) => setPrefs({ cursorStyle })}
          />
        </div>
      </div>

      {/* Cursor Blink */}
      <div className="aspro-setting-row">
        <div>
          <strong>{t('settings.terminalCursorBlink')}</strong>
        </div>
        <label className="aspro-hidden-toggle shrink-0">
          <input
            type="checkbox"
            checked={prefs.cursorBlink}
            onChange={(e) => setPrefs({ cursorBlink: e.target.checked })}
          />
          <span>{t(prefs.cursorBlink ? 'applock.statusEnabled' : 'applock.statusDisabled')}</span>
        </label>
      </div>

      {/* Copy on select */}
      <div className="aspro-setting-row">
        <div>
          <strong>{t('settings.terminalCopyOnSelect')}</strong>
          <small>{t('settings.terminalCopyOnSelectDesc')}</small>
        </div>
        <label className="aspro-hidden-toggle shrink-0">
          <input
            type="checkbox"
            checked={prefs.copyOnSelect}
            onChange={(e) => setPrefs({ copyOnSelect: e.target.checked })}
          />
          <span>{t(prefs.copyOnSelect ? 'applock.statusEnabled' : 'applock.statusDisabled')}</span>
        </label>
      </div>

      {/* Paste on right click */}
      <div className="aspro-setting-row">
        <div>
          <strong>{t('settings.terminalPasteOnRightClick')}</strong>
          <small>{t('settings.terminalPasteOnRightClickDesc')}</small>
        </div>
        <label className="aspro-hidden-toggle shrink-0">
          <input
            type="checkbox"
            checked={prefs.pasteOnRightClick}
            onChange={(e) => setPrefs({ pasteOnRightClick: e.target.checked })}
          />
          <span>{t(prefs.pasteOnRightClick ? 'applock.statusEnabled' : 'applock.statusDisabled')}</span>
        </label>
      </div>

      {/* Scrollback */}
      <div className="aspro-setting-row">
        <div>
          <strong>{t('settings.terminalScrollback')}</strong>
          <small>{t('settings.terminalScrollbackDesc')}</small>
        </div>
        <NumberField
          value={prefs.scrollback}
          min={500}
          max={100_000}
          width="w-24"
          suffix={t('settings.terminalScrollbackUnit')}
          onCommit={(scrollback) => setPrefs({ scrollback })}
        />
      </div>

      {/* Reset */}
      <div className="aspro-setting-row">
        <div>
          <strong>{t('settings.terminalResetTitle')}</strong>
          <small>{t('settings.terminalResetDesc')}</small>
        </div>
        <button
          type="button"
          onClick={resetPrefs}
          className="aspro-button aspro-button-secondary compact shrink-0"
        >
          {t('settings.sshReset')}
        </button>
      </div>
    </>
  );
}

function CursorStyleButton({
  value,
  current,
  label,
  onSelect,
}: {
  value: CursorStyle;
  current: CursorStyle;
  label: string;
  onSelect: (value: CursorStyle) => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={current === value}
      className={current === value ? 'active' : ''}
      onClick={() => onSelect(value)}
    >
      {label}
    </button>
  );
}

function WorkspaceSettings() {
  const { t } = useI18n();
  const { prefs, setPrefs, resetPrefs } = useWorkspacePrefs();
  const [profiles, setProfiles] = useState<LocalTerminalProfile[]>([]);

  useEffect(() => {
    void window.ssh.local.list().then(setProfiles).catch(() => []);
  }, []);

  const pickFolder = async () => {
    const folder = await window.ssh.dialog.pickProjectFolder();
    if (folder) setPrefs({ defaultProjectFolder: folder });
  };

  return (
    <>
      <div className="aspro-setting-row">
        <div>
          <strong>{t('settings.wsDefaultShell')}</strong>
          <small>{t('settings.wsDefaultShellDesc')}</small>
        </div>
        <select
          value={prefs.defaultShell}
          onChange={(e) => setPrefs({ defaultShell: e.target.value })}
          className="aspro-input w-52 shrink-0 px-3 py-1.5 text-sm text-fg focus:border-azure focus:outline-none"
        >
          <option value="auto">{t('settings.wsDefaultShellAuto')}</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.command})
            </option>
          ))}
        </select>
      </div>

      <div className="aspro-setting-row">
        <div>
          <strong>{t('settings.wsDefaultFolder')}</strong>
          <small>{t('settings.wsDefaultFolderDesc')}</small>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <input
            type="text"
            readOnly
            value={prefs.defaultProjectFolder}
            placeholder={t('settings.wsDefaultFolderPlaceholder')}
            title={prefs.defaultProjectFolder || undefined}
            className="aspro-input w-48 truncate px-3 py-1.5 text-sm text-fg"
          />
          {prefs.defaultProjectFolder && (
            <button
              type="button"
              onClick={() => setPrefs({ defaultProjectFolder: '' })}
              title="Reset folder default"
              className="rounded px-1.5 py-1 text-faint hover:bg-line hover:text-fg"
            >
              ✕
            </button>
          )}
          <button
            type="button"
            onClick={() => void pickFolder()}
            className="aspro-button aspro-button-secondary compact"
          >
            {t('settings.sftpChooseFolder')}
          </button>
        </div>
      </div>

      <div className="aspro-setting-row">
        <div>
          <strong>{t('settings.wsConfirmElevated')}</strong>
          <small>{t('settings.wsConfirmElevatedDesc')}</small>
        </div>
        <label className="aspro-hidden-toggle shrink-0">
          <input
            type="checkbox"
            checked={prefs.confirmElevatedLaunch}
            onChange={(e) => setPrefs({ confirmElevatedLaunch: e.target.checked })}
          />
          <span>{t(prefs.confirmElevatedLaunch ? 'applock.statusEnabled' : 'applock.statusDisabled')}</span>
        </label>
      </div>

      <div className="aspro-setting-row">
        <div>
          <strong>{t('settings.wsUiDensity')}</strong>
          <small>{t('settings.wsUiDensityDesc')}</small>
        </div>
        <div className="aspro-language-switch shrink-0" role="radiogroup">
          <button
            type="button"
            className={prefs.uiDensity === 'comfortable' ? 'active' : ''}
            onClick={() => setPrefs({ uiDensity: 'comfortable' })}
          >
            {t('settings.wsUiComfortable')}
          </button>
          <button
            type="button"
            className={prefs.uiDensity === 'compact' ? 'active' : ''}
            onClick={() => setPrefs({ uiDensity: 'compact' })}
          >
            {t('settings.wsUiCompact')}
          </button>
        </div>
      </div>

      <div className="aspro-setting-row">
        <div>
          <strong>{t('settings.wsTabTitle')}</strong>
          <small>{t('settings.wsTabTitleDesc')}</small>
        </div>
        <div className="aspro-language-switch shrink-0" role="radiogroup">
          <button
            type="button"
            className={prefs.tabTitleFormat === 'name' ? 'active' : ''}
            onClick={() => setPrefs({ tabTitleFormat: 'name' })}
          >
            {t('settings.wsTabTitleName')}
          </button>
          <button
            type="button"
            className={prefs.tabTitleFormat === 'name-host' ? 'active' : ''}
            onClick={() => setPrefs({ tabTitleFormat: 'name-host' })}
          >
            {t('settings.wsTabTitleHost')}
          </button>
        </div>
      </div>

      <div className="aspro-setting-row">
        <div>
          <strong>{t('settings.terminalResetTitle')}</strong>
          <small>Kembalikan preferensi workspace lokal ke default.</small>
        </div>
        <button
          type="button"
          onClick={resetPrefs}
          className="aspro-button aspro-button-secondary compact shrink-0"
        >
          {t('settings.sshReset')}
        </button>
      </div>
    </>
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
          <strong>{t('settings.sshDefaultPort')}</strong>
          <small>{t('settings.sshDefaultPortDesc')}</small>
        </div>
        <NumberField
          value={prefs.defaultPort ?? 22}
          min={1}
          max={65535}
          suffix="port"
          width="w-20"
          onCommit={(port) => update({ defaultPort: port })}
        />
      </div>

      <div className="aspro-setting-row">
        <div>
          <strong>{t('settings.sshDefaultUsername')}</strong>
          <small>{t('settings.sshDefaultUsernameDesc')}</small>
        </div>
        <input
          type="text"
          value={prefs.defaultUsername ?? ''}
          onChange={(e) => update({ defaultUsername: e.target.value })}
          placeholder="mis. root atau ubuntu"
          className="aspro-input w-48 shrink-0 px-3 py-1.5 text-sm text-fg focus:border-azure focus:outline-none"
        />
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
  suffix = 's',
  width = 'w-16',
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  suffix?: string;
  width?: string;
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
        className={`aspro-input ${width} px-2 py-1.5 text-right text-sm text-fg focus:border-azure focus:outline-none`}
      />
      <span className="text-xs text-faint">{suffix}</span>
    </div>
  );
}

const CONFLICT_POLICIES: ConflictPolicy[] = ['ask', 'overwrite', 'skip', 'rename'];

function conflictLabelKey(policy: ConflictPolicy) {
  switch (policy) {
    case 'ask':
      return 'settings.sftpConflictAsk' as const;
    case 'overwrite':
      return 'settings.sftpConflictOverwrite' as const;
    case 'skip':
      return 'settings.sftpConflictSkip' as const;
    case 'rename':
      return 'settings.sftpConflictRename' as const;
  }
}

function SftpSettings() {
  const { t } = useI18n();
  const [prefs, setPrefs] = useState<SftpPreferences | null>(null);

  useEffect(() => {
    void window.ssh.settings.sftpGet().then(setPrefs);
  }, []);

  if (!prefs) return null;

  const update = (patch: Partial<SftpPreferences>) => {
    void window.ssh.settings.sftpUpdate(patch).then(setPrefs);
  };

  const pickFolder = async () => {
    const folder = await window.ssh.dialog.pickFolder();
    if (folder) update({ downloadFolder: folder });
  };

  return (
    <>
      <div className="aspro-setting-row">
        <div>
          <strong>{t('settings.sftpDownloadFolder')}</strong>
          <small>{t('settings.sftpDownloadFolderDesc')}</small>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <input
            type="text"
            readOnly
            value={prefs.downloadFolder}
            placeholder={t('settings.sftpDownloadFolderPlaceholder')}
            title={prefs.downloadFolder || undefined}
            className="aspro-input w-44 truncate px-3 py-1.5 text-sm text-fg"
          />
          {prefs.downloadFolder && (
            <button
              type="button"
              onClick={() => update({ downloadFolder: '' })}
              title={t('settings.sftpDownloadFolderPlaceholder')}
              className="rounded px-1.5 py-1 text-faint hover:bg-line hover:text-fg focus:outline-none"
            >
              ✕
            </button>
          )}
          <button
            type="button"
            onClick={() => void pickFolder()}
            className="aspro-button aspro-button-secondary compact"
          >
            {t('settings.sftpChooseFolder')}
          </button>
        </div>
      </div>

      <div className="aspro-setting-row">
        <div>
          <strong>{t('settings.sftpUploadConflict')}</strong>
        </div>
        <div className="aspro-language-switch shrink-0" role="radiogroup">
          {CONFLICT_POLICIES.map((policy) => (
            <ConflictPolicyButton
              key={policy}
              value={policy}
              current={prefs.uploadConflict}
              label={t(conflictLabelKey(policy))}
              onSelect={(uploadConflict) => update({ uploadConflict })}
            />
          ))}
        </div>
      </div>

      <div className="aspro-setting-row">
        <div>
          <strong>{t('settings.sftpDownloadConflict')}</strong>
          <small>{t('settings.sftpDownloadConflictDesc')}</small>
        </div>
        <div className="aspro-language-switch shrink-0" role="radiogroup">
          {CONFLICT_POLICIES.map((policy) => (
            <ConflictPolicyButton
              key={policy}
              value={policy}
              current={prefs.downloadConflict}
              label={t(conflictLabelKey(policy))}
              onSelect={(downloadConflict) => update({ downloadConflict })}
            />
          ))}
        </div>
      </div>

      <div className="aspro-setting-row">
        <div>
          <strong>{t('settings.sftpResetTitle')}</strong>
          <small>{t('settings.sftpResetDesc')}</small>
        </div>
        <button
          type="button"
          onClick={() => void window.ssh.settings.sftpReset().then(setPrefs)}
          className="aspro-button aspro-button-secondary compact shrink-0"
        >
          {t('settings.sshReset')}
        </button>
      </div>
    </>
  );
}

function ConflictPolicyButton({
  value,
  current,
  label,
  onSelect,
}: {
  value: ConflictPolicy;
  current: ConflictPolicy;
  label: string;
  onSelect: (value: ConflictPolicy) => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={current === value}
      className={current === value ? 'active' : ''}
      onClick={() => onSelect(value)}
    >
      {label}
    </button>
  );
}

type LockMode = 'view' | 'setup' | 'change' | 'disable';

function AppLockSettings() {
  const { t } = useI18n();
  const [status, setStatus] = useState<{
    enabled: boolean;
    locked: boolean;
    idleMinutes: number;
  } | null>(null);
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
      <>
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

        {status.enabled && (
          <div className="aspro-setting-row">
            <div>
              <strong>{t('applock.idleTitle')}</strong>
              <small>{t('applock.idleDesc')}</small>
            </div>
            <NumberField
              value={status.idleMinutes}
              min={0}
              max={180}
              suffix={t('applock.idleSuffix')}
              onCommit={(minutes) =>
                void window.ssh.appLock.setIdleMinutes(minutes).then(setStatus)
              }
            />
          </div>
        )}
      </>
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

function BackupSettings() {
  const { t } = useI18n();
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleExport = async () => {
    setExporting(true);
    setStatus(null);
    try {
      const res = await window.ssh.backup.export();
      if (res.canceled) return;
      if (res.success) {
        setStatus({
          type: 'success',
          text: t('settings.backupExportSuccess', {
            count: res.count ?? 0,
            path: res.filePath ? res.filePath.split(/[\\/]/).pop() ?? res.filePath : '',
          }),
        });
      } else {
        setStatus({
          type: 'error',
          text: res.error || 'Failed to export backup.',
        });
      }
    } catch (err) {
      setStatus({
        type: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async () => {
    setImporting(true);
    setStatus(null);
    try {
      const res = await window.ssh.backup.import();
      if (res.canceled) return;
      if (res.success) {
        setStatus({
          type: 'success',
          text: t('settings.backupImportSuccess', {
            sessions: res.importedSessions ?? 0,
            groups: res.importedGroups ?? 0,
          }),
        });
      } else {
        setStatus({
          type: 'error',
          text: res.error || 'Failed to import backup.',
        });
      }
    } catch (err) {
      setStatus({
        type: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setImporting(false);
    }
  };

  return (
    <>
      <div className="mb-4 rounded-lg border border-azure/30 bg-azure/10 p-3.5 text-xs text-muted flex items-start gap-2.5">
        <span className="text-base text-azure shrink-0">🛡️</span>
        <div className="leading-relaxed">
          {t('settings.backupSecurityNote')}
        </div>
      </div>

      {status && (
        <div
          className={`mb-4 rounded-lg border p-3 text-xs flex items-center justify-between ${
            status.type === 'success'
              ? 'border-mint/40 bg-mint/10 text-mint'
              : 'border-coral/40 bg-coral/10 text-coral'
          }`}
        >
          <span>{status.text}</span>
          <button
            type="button"
            onClick={() => setStatus(null)}
            className="ml-2 text-faint hover:text-fg text-xs"
          >
            ✕
          </button>
        </div>
      )}

      {/* Export Row */}
      <div className="aspro-setting-row">
        <div>
          <strong>{t('settings.backupExportTitle')}</strong>
          <small>{t('settings.backupExportDesc')}</small>
        </div>
        <button
          type="button"
          onClick={() => void handleExport()}
          disabled={exporting || importing}
          className="aspro-button aspro-button-secondary compact shrink-0 gap-1.5 disabled:opacity-40"
        >
          <span>📤</span>
          <span>{exporting ? t('settings.backupProcessing') : t('settings.backupExportButton')}</span>
        </button>
      </div>

      {/* Import Row */}
      <div className="aspro-setting-row">
        <div>
          <strong>{t('settings.backupImportTitle')}</strong>
          <small>{t('settings.backupImportDesc')}</small>
        </div>
        <button
          type="button"
          onClick={() => void handleImport()}
          disabled={exporting || importing}
          className="aspro-button aspro-button-primary compact shrink-0 gap-1.5 disabled:opacity-40"
        >
          <span>📥</span>
          <span>{importing ? t('settings.backupProcessing') : t('settings.backupImportButton')}</span>
        </button>
      </div>
    </>
  );
}

function AboutSettings() {
  const { t } = useI18n();
  const [version, setVersion] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<UpdateCheckResult | null>(null);

  useEffect(() => {
    void window.ssh.app.getVersion().then(setVersion);
  }, []);

  const checkUpdate = async () => {
    setChecking(true);
    setResult(null);
    try {
      setResult(await window.ssh.app.checkUpdate());
    } finally {
      setChecking(false);
    }
  };

  return (
    <>
      <div className="aspro-setting-row">
        <div>
          <strong>ASProOps</strong>
          <small>{t('settings.currentVersion', { version: version ?? '…' })}</small>
        </div>
        <button
          type="button"
          onClick={() => void checkUpdate()}
          disabled={checking}
          className="aspro-button aspro-button-secondary compact shrink-0 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {checking ? t('settings.checkingUpdate') : t('settings.checkUpdate')}
        </button>
      </div>

      {result && (
        <div className="aspro-setting-row">
          <div>
            {result.error ? (
              <>
                <strong className="text-coral">{t('settings.updateCheckFailed')}</strong>
                <small>{result.error}</small>
              </>
            ) : result.hasUpdate ? (
              <>
                <strong className="text-mint">
                  {t('settings.updateAvailable', { version: result.latestVersion ?? '' })}
                </strong>
                <small>{t('settings.updateAvailableDesc')}</small>
              </>
            ) : (
              <>
                <strong>{t('settings.upToDate')}</strong>
                <small>{t('settings.upToDateDesc')}</small>
              </>
            )}
          </div>
          {result.hasUpdate && result.releaseUrl && (
            <button
              type="button"
              onClick={() => void window.ssh.app.openExternal(result.releaseUrl!)}
              className="aspro-button aspro-button-primary compact shrink-0"
            >
              {t('settings.openRelease')}
            </button>
          )}
        </div>
      )}
    </>
  );
}
