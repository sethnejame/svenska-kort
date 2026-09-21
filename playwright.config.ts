import { defineConfig, devices } from '@playwright/test';

/**
 * The smoke test runs against `vite preview` of the production build, never the
 * dev server. The dev server serves modules from source and rewrites paths on the
 * fly, which hides the class of bug that only ever shows up once the build is
 * addressed at a real URL — and that bug breaks the deployed site and nothing else.
 */
const PORT = 4173;
/** Matches the Vite `base`: the app is served from the apex svenskakort.se. */
const BASE = '/';

export default defineConfig({
  testDir: './tests/e2e',
  // A flake here is a real signal, not something to paper over with retries.
  retries: 0,
  fullyParallel: true,
  // On CI the annotations land on the diff, and the HTML report carries the trace
  // for anything the annotation alone cannot explain.
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${String(PORT)}${BASE}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'mobile',
      use: {
        ...devices['Desktop Chrome'],
        // The viewport the whole app was designed against.
        viewport: { width: 375, height: 667 },
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
  webServer: {
    command: `npm run preview -- --port ${String(PORT)} --strictPort`,
    url: `http://localhost:${String(PORT)}${BASE}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
