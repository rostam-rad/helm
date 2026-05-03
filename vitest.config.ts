import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@renderer': path.resolve(__dirname, 'src/renderer'),
    },
  },
  css: { postcss: { plugins: [] } },
  test: {
    include: ['tests/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    environment: 'node',
  },
});
