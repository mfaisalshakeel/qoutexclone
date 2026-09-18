import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_WEB_PORT ?? 5173);
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

// CI installs the browser Playwright pins. Sandboxes and dev machines that
// already carry a Chromium can point at it instead of downloading another.
const executablePath = process.env.E2E_CHROMIUM_PATH;
const launchOptions = executablePath ? { executablePath } : undefined;

/**
 * End-to-end suite. By default it drives whatever is already running on
 * :5173 / :4000; with E2E_MANAGE_SERVERS=1 (CI) it starts the API and Vite
 * itself and waits for them to answer.
 */
export default defineConfig({
  testDir: './e2e',
  // trades settle on real timers, so specs need room
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  outputDir: 'e2e-results',

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 20_000,
    launchOptions,
  },

  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
      // the phone terminal has no desktop equivalent: its dock and its sheets
      // only exist below the md breakpoint
      testIgnore: /mobile\.spec\.ts/,
    },
    // the phone project runs the specs written for it, not the whole suite
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /(responsive|mobile)\.spec\.ts/ },
  ],

  ...(process.env.E2E_MANAGE_SERVERS
    ? {
        webServer: [
          {
            command: 'npm start --workspace=server',
            url: 'http://localhost:4000/api/health',
            reuseExistingServer: true,
            timeout: 120_000,
          },
          {
            command: 'npm run dev --workspace=web',
            url: BASE_URL,
            reuseExistingServer: true,
            timeout: 120_000,
          },
        ],
      }
    : {}),
});
