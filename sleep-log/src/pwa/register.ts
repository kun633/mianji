import { registerSW } from 'virtual:pwa-register';

export function registerAppServiceWorker(onNeedRefresh: () => void) {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return () => Promise.resolve();
  }
  return registerSW({
    immediate: true,
    onNeedRefresh,
    onRegisteredSW: (_url, registration) => {
      window.setInterval(() => {
        registration?.update().catch(() => undefined);
      }, 60 * 60 * 1000);
    },
  });
}
