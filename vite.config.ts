import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/** Konfigurasi renderer (React). Main dan preload punya konfigurasi sendiri. */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Path relatif diperlukan agar aset tetap ditemukan saat Electron memuat
  // berkas hasil build lewat protokol file://.
  base: './',
  server: {
    port: 5173,
    strictPort: true,
    // File asing (bukan bagian source) kadang muncul sesaat di root project
    // dari proses lain di luar app ini dan terkunci OS — watcher yang
    // mencoba memantaunya bikin seluruh dev server crash (EBUSY). Proyek
    // ini tidak pernah punya .zip sebagai source, jadi aman diabaikan.
    watch: { ignored: ['**/*.zip'] },
  },
  build: {
    outDir: 'out/renderer',
    emptyOutDir: true,
    // Chromium di Electron selalu versi mutakhir, jadi tidak perlu
    // menurunkan sintaks untuk peramban lama.
    target: 'esnext',
  },
});
