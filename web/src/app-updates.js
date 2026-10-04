import { latestRelease } from './release-info.js';

export const APP_VERSION = '0.4.2';

// Announce a waiting worker; never replace an editor while it is in use.
export async function watchForUpdates(onReady) {
  if (!('serviceWorker' in navigator)) return;
  // Use the release in the script URL so an old HTTP cache cannot masquerade
  // as the current worker. The recovery page registers this same URL.
  let release;
  try { release = await latestRelease(); } catch { /* Offline startup still works. */ }
  const registration = await navigator.serviceWorker.register(`./sw.js?release=${release?.version || APP_VERSION}`, { updateViaCache: 'none' });
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
