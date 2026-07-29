/**
 * NIZAM · Vite config (React plugin, @ alias, vitest)
 * Implemented by: KIRO Contract 1 / Phase 1.2
 * Depends on: package.json
 */
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  // Relative base so the static build works on GitHub Pages / any sub-path host.
  base: './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['tests/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
    globals: false,
  },
});
