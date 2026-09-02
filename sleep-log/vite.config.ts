import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

const mockPath = decodeURIComponent(
  new URL('./src/pwa/virtual-mock.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
);

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon-192.svg', 'icon-512.svg'],
      manifest: {
        name: '眠记',
        short_name: '眠记',
        lang: 'zh-CN',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#f5f7fb',
        theme_color: '#354c89',
        icons: [
          { src: 'icon-192.svg', sizes: '192x192', type: 'image/svg+xml' },
          { src: 'icon-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    pool: 'threads',
    restoreMocks: true,
    include: ['src/**/*.test.{ts,tsx}'],
    alias: {
      'virtual:pwa-register': mockPath,
    },
  },
});
