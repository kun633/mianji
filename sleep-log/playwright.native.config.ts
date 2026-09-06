import { defineConfig } from '@playwright/test';

// The stale-worker fixture hosts its own origin; no Vite server is needed.
export default defineConfig({
  testDir: './tests',
  testMatch: 'native-cache-recovery.spec.ts',
  timeout: 90_000,
  workers: 1,
});
