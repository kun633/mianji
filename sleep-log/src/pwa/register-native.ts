// Android assets update with the APK. A web service worker can pin a broken old
// bundle and prevent even React's update prompt from mounting.
export function registerAppServiceWorker(_onNeedRefresh: () => void) {
  return (_reloadPage?: boolean) => Promise.resolve();
}
