import { defineConfig } from 'vite';

export default defineConfig({
  build: { outDir: 'dist', chunkSizeWarningLimit: 2000 },
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
  },
});
