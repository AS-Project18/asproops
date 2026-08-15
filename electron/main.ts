import { join } from 'node:path';
import { app, BrowserWindow, Menu } from 'electron';

import { registerIpc, shutdown } from './ipc';

/** Diisi oleh scripts/dev.mjs; kosong pada build produksi. */
const devServerUrl = process.env.VITE_DEV_SERVER_URL;

app.setName('ASProOps');

function appIconPath(): string {
  return join(
    app.getAppPath(),
    'assets',
    process.platform === 'win32' ? 'asproops.ico' : 'asproops-icon.png',
  );
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1580,
    height: 920,
    minWidth: 1180,
    minHeight: 700,
    backgroundColor: '#050208',
    icon: appIconPath(),
    show: false,
    webPreferences: {
      // main.cjs dan preload.cjs sama-sama ada di out/.
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // Preload perlu require('electron'); contextIsolation tetap menjaga
      // renderer terpisah dari konteks Node.
      sandbox: false,
    },
  });

  window.once('ready-to-show', () => window.show());

  if (devServerUrl) {
    void window.loadURL(devServerUrl);
    window.webContents.openDevTools({ mode: 'detach' });
  } else {
    void window.loadFile(join(__dirname, 'renderer/index.html'));
  }

  return window;
}

void app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.asproops.desktop');
  }

  // ASProOps memakai navigasi/action sendiri. Menu default File/Edit/View/
  // Window/Help Electron hanya menduplikasi UI dan dihilangkan.
  Menu.setApplicationMenu(null);

  registerIpc(createWindow());

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) registerIpc(createWindow());
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', shutdown);
