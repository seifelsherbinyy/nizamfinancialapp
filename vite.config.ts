/**
 * NIZAM · Vite config (React plugin, @ alias, vitest, PWA)
 * Implemented by: KIRO Contract 1 / Phase 1.2 (PWA added by Contract 5 / Phase 5.3)
 * Depends on: package.json
 */
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [
    react(),
    // Offline PWA: generateSW strategy precaches ONLY local build assets.
    VitePWA({
      strategies: 'generateSW',
      registerType: 'autoUpdate',
      injectRegister: 'script-defer',
      // The manifest is authored by hand in public/manifest.webmanifest.
      manifest: false,
      includeAssets: ['icon.svg', 'icon-maskable.svg', 'manifest.webmanifest'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,webmanifest}'],
        // Never intercept Drive/auth calls — the app handles offline itself via Dexie.
        navigateFallback: 'index.html',
        runtimeCaching: [],
      },
    }),
  ],
  // Relative base so the static build works on GitHub Pages / any sub-path host.
  base: './',
  // Pin the dev origin so the Google OAuth Web client + API key (both locked to
  // http://localhost:5173) never drift. strictPort => Vite FAILS LOUD if 5173 is
  // taken, instead of silently moving to 5174 and breaking Drive sign-in.
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
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
