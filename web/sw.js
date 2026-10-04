const PREFIX = `shinian:${new URL(self.registration.scope).pathname}:`;
const CACHE = `${PREFIX}v12`;
const ASSETS = [
  './', './index.html', './styles.css', './fonts.css', './manifest.webmanifest',
  './src/app-updates.js', './src/references.js', './src/app.js', './src/model.js', './src/storage.js', './src/github.js', './src/images.js', './src/markdown.js', './src/body-editor.js', './src/plugin-connection.js',
  './integrations/chatgpt-openapi.template.json', './integrations/chatgpt-instructions.md', './integrations/shinian-plugin.zip',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'
];
const ALLOWED = new Set(ASSETS.map(path => new URL(path, self.registration.scope).href));
// update.html and src/update.js deliberately stay network-only, so a recovery
// entry can bypass an old app cache without touching IndexedDB or credentials.
self.addEventListener('install', event => {
  // A new cache version must not be populated from still-fresh HTTP cache entries
  // left by the previous release (Pages serves assets with a cache lifetime).
  const requests = ASSETS.map(path => new Request(new URL(path, self.registration.scope), { cache: 'reload' }));
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(requests)));
  // Wait for every old client to close before activating a different app version.
});
self.addEventListener('message', event => {
  // Only the explicit recovery page activates a waiting version. Its editor
  // lock prevents switching modules underneath an open editor.
  if (event.data?.type !== 'ACTIVATE_UPDATE' || !event.source?.url) return;
  const source = new URL(event.source.url);
  const recovery = new URL('./update.html', self.registration.scope);
  if (source.origin === recovery.origin && source.pathname === recovery.pathname) event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Never cache GitHub API requests, credentials, or user data.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (!ALLOWED.has(url.href)) return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(event.request);
    if (cached) return cached;
    return fetch(event.request);
  }));
});
