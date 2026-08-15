import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { rebuild } from '@electron/rebuild';

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
const nodePtyVersion = packageVersion('node-pty');

if (!electronVersion) {
  console.error('[ASProOps] Paket Electron belum terpasang.');
  process.exit(1);
}

if (!nodePtyVersion) {
  console.error('[ASProOps] Paket node-pty belum terpasang.');
  process.exit(1);
}

const signature = {
  electronVersion,
  nodePtyVersion,
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
  cached.nodePtyVersion === signature.nodePtyVersion &&
  cached.platform === signature.platform &&
  cached.arch === signature.arch;

if (upToDate) {
  console.log(
    `[ASProOps] node-pty sudah cocok untuk Electron ${electronVersion} ` +
      `(${process.platform}/${process.arch}) — rebuild dilewati.`,
  );
  process.exit(0);
}

console.log(
  `[ASProOps] Rebuild node-pty untuk Electron ${electronVersion} ` +
    `(${process.platform}/${process.arch})`,
);

try {
  await rebuild({
    buildPath: projectRoot,
    electronVersion,
    force: true,
    onlyModules: ['node-pty'],
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

  console.log('[ASProOps] node-pty rebuild selesai dan cache build disimpan.');
} catch (error) {
  console.error('[ASProOps] node-pty rebuild gagal.');
  console.error(error);
  process.exit(1);
}
