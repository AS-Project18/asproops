import { builtinModules } from 'node:module';
import { defineConfig } from 'vite';

/**
 * Build proses main.
 *
 * Keluarannya CommonJS berekstensi .cjs supaya Electron memuatnya sebagai
 * CJS terlepas dari `"type": "module"` di package.json — ini menghindari
 * seluruh kelas masalah interop ESM di proses main.
 */
export default defineConfig({
  build: {
    outDir: 'out',
    emptyOutDir: false,
    target: 'node22',
    minify: false,
    sourcemap: true,
    lib: {
      entry: 'electron/main.ts',
      formats: ['cjs'],
      fileName: () => 'main.cjs',
    },
    rollupOptions: {
      external: [
        'electron',
        // ssh2 memuat binding kripto opsional secara dinamis; membundelnya
        // akan memutus jalur itu, jadi biarkan di-resolve saat runtime.
        'ssh2',
        // Native ConPTY binding. Harus di-resolve dari node_modules saat runtime.
        'node-pty',
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`),
      ],
    },
  },
});
