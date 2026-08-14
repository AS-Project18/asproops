import { spawn } from 'node:child_process';
import { createServer, build } from 'vite';
import electronPath from 'electron';

/**
 * Orkestrator mode pengembangan.
 *
 * Menggantikan `concurrently` + `wait-on` + `electron-vite` dengan sekitar
 * enam puluh baris yang memakai API JavaScript milik Vite langsung. Tidak
 * ada dependensi tambahan, jadi tidak ada pohon dependensi pihak ketiga
 * yang bisa usang.
 *
 * Alurnya:
 *   1. Jalankan dev server Vite untuk renderer
 *   2. Build main dan preload dalam mode watch
 *   3. Jalankan Electron, arahkan ke dev server
 *   4. Kalau main atau preload berubah, jalankan ulang Electron
 */

let electron = null;
let restarting = false;

function startElectron(devServerUrl) {
  electron = spawn(electronPath, ['.'], {
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: devServerUrl, NODE_ENV: 'development' },
  });

  electron.on('exit', (code) => {
    // Keluar karena restart kita sendiri bukan alasan untuk menutup dev server.
    if (restarting) return;
    process.exit(code ?? 0);
  });
}

function restartElectron(devServerUrl) {
  if (!electron) return startElectron(devServerUrl);
  restarting = true;
  electron.removeAllListeners('exit');
  electron.once('exit', () => {
    restarting = false;
    startElectron(devServerUrl);
  });
  electron.kill();
}

const server = await createServer({ configFile: 'vite.config.ts' });
await server.listen();
server.printUrls();

const devServerUrl = server.resolvedUrls.local[0];

// Build pertama harus selesai sebelum Electron dijalankan, kalau tidak
// `out/main.cjs` belum ada saat Electron mencarinya.
let started = false;
const onRebuild = () => {
  if (!started) {
    started = true;
    startElectron(devServerUrl);
  } else {
    console.log('\n[dev] proses main berubah — menjalankan ulang Electron');
    restartElectron(devServerUrl);
  }
};

for (const configFile of ['vite.main.config.ts', 'vite.preload.config.ts']) {
  const watcher = await build({ configFile, build: { watch: {} } });
  watcher.on('event', (event) => {
    if (event.code === 'BUNDLE_END') onRebuild();
    if (event.code === 'ERROR') console.error('[dev]', event.error);
  });
}

const shutdown = async () => {
  restarting = true;
  electron?.kill();
  await server.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
