import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  build: {
    outDir: 'dist',
    target: 'es2020',
    // esbuild minifier (Vite default) — fast, effective, zero extra deps
    minify: 'esbuild',
    assetsInlineLimit: 0,
  },
  esbuild: {
    drop: ['console'],
  },
  server: {
    open: false,
  },
});
