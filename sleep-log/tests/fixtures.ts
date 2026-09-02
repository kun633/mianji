import type { Page } from '@playwright/test';
import type { SleepSegment } from '../src/domain/sleep';

export async function seedIndexedDb(page: Page, segments: SleepSegment[]) {
  await page.evaluate(async (items) => {
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('mianji-sleep-log', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('segments')) {
          const store = db.createObjectStore('segments', { keyPath: 'id' });
          store.createIndex('by-status', 'status');
          store.createIndex('by-start', 'startAt');
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('segments', 'readwrite');
        const store = tx.objectStore('segments');
        store.clear();
        for (const item of items) {
          store.put(item);
        }
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      };
      request.onerror = () => reject(request.error);
    });
  }, segments);
}
