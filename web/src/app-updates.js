export const APP_VERSION = '0.4.1';

// Announce a waiting worker; never replace an editor while it is in use.
export async function watchForUpdates(onReady) {
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
  const announce = () => { if (registration.waiting) onReady(); };
  const watch = () => {
    const worker = registration.installing;
    if (worker) worker.addEventListener('statechange', announce);
  };
  registration.addEventListener('updatefound', watch);
  watch(); announce();
  await registration.update();
  announce();
}
