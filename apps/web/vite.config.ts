import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@sketch-maker/shared-types': path.resolve(__dirname, '../../packages/shared-types/src'),
      '@sketch-maker/image-processing': path.resolve(__dirname, '../../packages/image-processing/src'),
      '@sketch-maker/structural-analysis': path.resolve(__dirname, '../../packages/structural-analysis/src'),
      '@sketch-maker/stroke-engine': path.resolve(__dirname, '../../packages/stroke-engine/src'),
      '@sketch-maker/style-engine': path.resolve(__dirname, '../../packages/style-engine/src'),
      '@sketch-maker/animation-engine': path.resolve(__dirname, '../../packages/animation-engine/src'),
      '@sketch-maker/export-engine': path.resolve(__dirname, '../../packages/export-engine/src'),
    },
  },
  server: {
    port: 3000,
    open: false,
  },
});
