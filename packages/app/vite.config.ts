import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Electron loads the built index.html via file://, which needs relative
  // asset URLs — Vite's default `base: '/'` produces absolute paths that
  // 404 under file://.
  base: './',
});
