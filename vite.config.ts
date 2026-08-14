import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/** Konfigurasi renderer (React). Main dan preload punya konfigurasi sendiri. */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Path relatif diperlukan agar aset tetap ditemukan saat Electron memuat
  // berkas hasil build lewat protokol file://.
  base: './',
  server: { port: 5173, strictPort: true },
  build: {
    outDir: 'out/renderer',
    emptyOutDir: true,
    // Chromium di Electron selalu versi mutakhir, jadi tidak perlu
    // menurunkan sintaks untuk peramban lama.
    target: 'esnext',
  },
});
