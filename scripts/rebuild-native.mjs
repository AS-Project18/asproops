import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { rebuild } from '@electron/rebuild';

/**
 * Rebuild `cpu-features` (dependency `ssh2`) supaya ABI-nya cocok dengan
 * Electron yang sedang dipakai — modul ini pakai NAN (Native Abstractions
 * for Node), jadi TIDAK ABI-stable lintas versi Node/Electron seperti N-API.
 *
 * `node-pty` SENGAJA tidak direbuild di sini: sejak versi yang dipakai
 * project ini pakai `node-addon-api` (N-API, ABI-stable), binary prebuilt
 * bawaan paketnya (`node_modules/node-pty/prebuilds/`) sudah langsung jalan
 * di Electron versi berapa pun tanpa rebuild. Rebuild dari source-nya malah
 * SELALU gagal di Windows karena submodule winpty di paket npm yang
 * dipublish tidak menyertakan berkas `deps/winpty/shared/GetCommitHash.bat`
 * yang dibutuhkan winpty.gyp — itu bug packaging upstream, bukan sesuatu
 * yang bisa diperbaiki dari sisi project ini. Kalau `cpu-features` gagal
 * dimuat (ABI tidak cocok), `ssh2` sudah punya fallback aman lewat
 * try/catch sendiri (lihat node_modules/ssh2/lib/protocol/constants.js) —
 * cuma kehilangan optimasi urutan cipher berbasis fitur CPU, bukan gagal
 * total.
 */

const require = createRequire(import.meta.url);
const projectRoot = process.cwd();
const markerPath = join(projectRoot, 'node_modules', '.asproops-native-build.json');

function packageVersion(name) {
  try {
    return require(`${name}/package.json`).version;
  } catch {
    return null;
  }
}

const electronVersion = packageVersion('electron');
const cpuFeaturesVersion = packageVersion('cpu-features');

if (!electronVersion) {
  console.error('[ASProOps] Paket Electron belum terpasang.');
  process.exit(1);
}

if (!cpuFeaturesVersion) {
  // ssh2 versi tertentu bisa saja tidak menarik cpu-features sama sekali
  // (mis. di platform yang tidak didukung) — tidak fatal, cuma tidak ada
  // yang perlu direbuild.
  console.log('[ASProOps] cpu-features tidak terpasang — rebuild native dilewati.');
  process.exit(0);
}

const signature = {
  electronVersion,
  cpuFeaturesVersion,
  platform: process.platform,
  arch: process.arch,
};

const force = process.argv.includes('--force');

let cached = null;
if (!force && existsSync(markerPath)) {
  try {
    cached = JSON.parse(await readFile(markerPath, 'utf8'));
  } catch {
    cached = null;
  }
}

const upToDate =
  !force &&
  cached &&
  cached.electronVersion === signature.electronVersion &&
  cached.cpuFeaturesVersion === signature.cpuFeaturesVersion &&
  cached.platform === signature.platform &&
  cached.arch === signature.arch;

if (upToDate) {
  console.log(
    `[ASProOps] cpu-features sudah cocok untuk Electron ${electronVersion} ` +
      `(${process.platform}/${process.arch}) — rebuild dilewati.`,
  );
  process.exit(0);
}

console.log(
  `[ASProOps] Rebuild cpu-features untuk Electron ${electronVersion} ` +
    `(${process.platform}/${process.arch})`,
);

try {
  await rebuild({
    buildPath: projectRoot,
    electronVersion,
    force: true,
    onlyModules: ['cpu-features'],
  });

  await mkdir(dirname(markerPath), { recursive: true });
  await writeFile(
    markerPath,
    JSON.stringify(
      {
        ...signature,
        builtAt: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );

  console.log('[ASProOps] cpu-features rebuild selesai dan cache build disimpan.');
} catch (error) {
  // Non-fatal dengan sengaja: ssh2 tetap berfungsi penuh tanpa cpu-features
  // (lihat catatan di atas), jadi kegagalan di sini tidak boleh membuat
  // `npm install` gagal total untuk seluruh project.
  console.error('[ASProOps] cpu-features rebuild gagal — ssh2 tetap berfungsi, cuma tanpa optimasi cipher berbasis CPU.');
  console.error(error);
}
