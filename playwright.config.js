import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  fullyParallel: true,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'node scripts/serve.mjs',
    port: 4173,
    reuseExistingServer: !process.env.CI
  },
  projects: [
    { name: 'desktop-1440x1000', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'tablet-820x1180', use: { viewport: { width: 820, height: 1180 } } },
    { name: 'mobile-390x844', use: { viewport: { width: 390, height: 844 } } }
  ]
});
