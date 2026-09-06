import { expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

test('native migration escapes a stale app shell without deleting records/settings', async ({ page }) => {
  let updated = false;
  const server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.url === '/sw.js') {
      res.setHeader('Content-Type', 'application/javascript');
      res.end(`
        self.addEventListener('install', e => e.waitUntil((async () => {
          const c = await caches.open('workbox-precache-v2-test');
          await c.add('/'); await self.skipWaiting();
        })()));
        self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
        self.addEventListener('fetch', e => {
          if (e.request.mode === 'navigate') e.respondWith(caches.match('/'));
        });`);
    } else {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(updated ? '<body>当前安装包</body>' : `<body>旧版空白页<script>navigator.serviceWorker.register('/sw.js')</script></body>`);
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as {port: number};
  try {
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      localStorage.setItem('settings', 'keep');
      await new Promise<void>(resolve => {
        const request = indexedDB.open('preserve-records', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('records');
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('records', 'readwrite');
          tx.objectStore('records').put('record', 'id');
          tx.oncomplete = () => {db.close(); resolve();};
        };
      });
      await caches.open('user-owned-cache');
    });
    updated = true;
    await page.reload();
    await expect(page.locator('body')).toContainText('旧版空白页');
    const script = await readFile('android/app/src/main/assets/native-cache-reset.js', 'utf8');
    await Promise.all([page.waitForEvent('load'), page.evaluate(script)]);
    await expect(page.locator('body')).toContainText('当前安装包');
    const persisted = await page.evaluate(async () => ({
      settings: localStorage.getItem('settings'),
      workers: (await navigator.serviceWorker.getRegistrations()).length,
      cache: await caches.has('user-owned-cache'),
      record: await new Promise(resolve => {
        const request = indexedDB.open('preserve-records', 1);
        request.onsuccess = () => {
          const db = request.result;
          const read = db.transaction('records').objectStore('records').get('id');
          read.onsuccess = () => {db.close(); resolve(read.result);};
        };
      }),
    }));
    expect(persisted).toEqual({settings:'keep',workers:0,cache:true,record:'record'});
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
