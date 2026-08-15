import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AppLockGate } from './components/AppLockGate';
import { I18nProvider } from './i18n';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('Elemen #root tidak ditemukan di index.html.');

createRoot(container).render(
  <StrictMode>
    <I18nProvider>
      <AppLockGate>
        <App />
      </AppLockGate>
    </I18nProvider>
  </StrictMode>,
);
