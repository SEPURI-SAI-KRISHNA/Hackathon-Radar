import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // Cloudflare Pages serves this directory.
    outDir: 'dist',
    sourcemap: false,
  },
  server: {
    port: 5173,
  },
});
