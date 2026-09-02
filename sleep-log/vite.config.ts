import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    pool: 'threads',
    restoreMocks: true,
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
