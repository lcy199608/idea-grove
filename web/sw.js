const PREFIX = `shinian:${new URL(self.registration.scope).pathname}:`;
const CACHE = `${PREFIX}v4`;
const ASSETS = [
  './', './index.html', './styles.css', './fonts.css', './manifest.webmanifest',
  './src/app.js', './src/model.js', './src/storage.js', './src/github.js', './src/images.js', './src/markdown.js',
  './integrations/chatgpt-openapi.template.json', './integrations/chatgpt-instructions.md',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'
];
const ALLOWED = new Set(ASSETS.map(path => new URL(path, self.registration.scope).href));
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
  // Wait for every old client to close before activating a different app version.
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
