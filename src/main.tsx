import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AppLockGate } from './components/AppLockGate';
import { I18nProvider } from './i18n';
import { TerminalPrefsProvider } from './terminalPrefs';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('Elemen #root tidak ditemukan di index.html.');

createRoot(container).render(
  <StrictMode>
    <I18nProvider>
      <TerminalPrefsProvider>
        <AppLockGate>
          <App />
        </AppLockGate>
      </TerminalPrefsProvider>
    </I18nProvider>
  </StrictMode>,
);
