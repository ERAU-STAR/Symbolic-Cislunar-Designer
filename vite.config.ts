import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' so the build works from any sub-path (GitHub Pages, local file server)
export default defineConfig({
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
});
