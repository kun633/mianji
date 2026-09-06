// Injected by native code, so this recovery does not depend on cached HTML/React.
(async () => {
  if (!('serviceWorker' in navigator)) return;
  const registrations = await navigator.serviceWorker.getRegistrations();
  const oldAppWorkers = registrations.filter(registration => {
    const worker = registration.active || registration.waiting || registration.installing;
    if (!worker) return false;
    const url = new URL(worker.scriptURL);
    return url.origin === location.origin && url.pathname === '/sw.js';
  });
  if (!oldAppWorkers.length) return;
  await Promise.all(oldAppWorkers.map(registration => registration.unregister()));
  // Only discard Workbox's app-shell cache. Never clear user databases/settings.
  const keys = await caches.keys();
  await Promise.all(keys.filter(key => key.startsWith('workbox-precache-')).map(key => caches.delete(key)));
  location.reload();
})().catch(error => console.error('Native cache recovery failed', error));
