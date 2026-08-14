import { builtinModules } from 'node:module';
import { defineConfig } from 'vite';

/** Build preload. Sama seperti main: CommonJS, .cjs. */
export default defineConfig({
  build: {
    outDir: 'out',
    emptyOutDir: false,
    target: 'node22',
    minify: false,
    sourcemap: true,
    lib: {
      entry: 'electron/preload.ts',
      formats: ['cjs'],
      fileName: () => 'preload.cjs',
    },
    rollupOptions: {
      external: ['electron', ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
    },
  },
});
