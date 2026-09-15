import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The dev server proxies /api to the backend, so the browser only ever
    // talks to one origin. That keeps CORS out of the picture entirely —
    // in production nginx does the same job.
    proxy: {
      '/api': { target: process.env.API_ORIGIN ?? 'http://localhost:4000', changeOrigin: true },
      '/health': { target: process.env.API_ORIGIN ?? 'http://localhost:4000', changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
});
