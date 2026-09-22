import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/',
  plugins: [
    react(),
    VitePWA({
      // The app updates itself on the next load rather than asking. There is
      // nothing a learner could usefully decide here, and a prompt mid-session
      // would interrupt the one thing they came to do.
      registerType: 'autoUpdate',
      // `public/manifest.webmanifest` is hand-written and already linked from
      // index.html; generating a second one would put two in the build.
      manifest: false,
      workbox: {
        // The whole app is static and small: every word, icon and font file is
        // precached, so the first visit is the only one that needs a network.
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        // Hash routing means every URL is index.html, so a deep link opened
        // cold offline still resolves.
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            // The stylesheet names the font files, so it is revalidated rather
            // than frozen: a stale one can point at a URL Google has retired.
            urlPattern: ({ url }: { url: URL }) => url.origin === 'https://fonts.googleapis.com',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-stylesheets' },
          },
          {
            // The woff2 files themselves are immutable and versioned in the URL.
            urlPattern: ({ url }: { url: URL }) => url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-files',
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 16, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
      devOptions: {
        // Off by default: a service worker in dev caches the very thing you are
        // trying to change. `npm run build && npm run preview` is where to test it.
        enabled: false,
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'shared/**/*.test.ts', 'worker/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // `shared` and `worker/src` join `src/lib` at 100%: one is the arithmetic
      // both sides depend on, the other is code no learner can reach to report
      // a bug in.
      include: ['src/lib/**', 'shared/**', 'worker/src/**'],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
});
