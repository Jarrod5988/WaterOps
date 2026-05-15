const WATEROPS_CACHE = 'waterops-app-v2026-05-15-02';
const WATEROPS_APP_ROOT = new URL('./', self.registration.scope).href;
const WATEROPS_INDEX = new URL('./index.html', self.registration.scope).href;
const WATEROPS_CORE_ASSETS = [
  WATEROPS_APP_ROOT,
  WATEROPS_INDEX,
  new URL('./manifest.json', self.registration.scope).href,
  new URL('./apple-touch-icon.png', self.registration.scope).href,
  new URL('./apple-touch-icon-dark.png', self.registration.scope).href,
  new URL('./icon-512.png', self.registration.scope).href,
  new URL('./icon-512-dark.png', self.registration.scope).href
];
const WATEROPS_CDN_ASSETS = [
  'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
  'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
  'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js',
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(WATEROPS_CACHE)
      .then(cache => Promise.all(WATEROPS_CORE_ASSETS.map(asset =>
        cache.add(new Request(asset, { cache: 'reload' })).catch(error => console.info('WaterOps cache skipped', asset, error))
      )))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(key => key.startsWith('waterops-app-') && key !== WATEROPS_CACHE)
        .map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (request.mode === 'navigate' || request.destination === 'document') {
      event.respondWith(networkFirst(request, WATEROPS_INDEX));
      return;
    }
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  if (WATEROPS_CDN_ASSETS.includes(request.url)) {
    event.respondWith(cacheFirst(request));
  }
});

async function networkFirst(request, fallbackUrl = WATEROPS_INDEX) {
  const cache = await caches.open(WATEROPS_CACHE);
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') return cache.match(fallbackUrl);
    throw error;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(WATEROPS_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then(response => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  if (cached) return cached;
  const response = await network;
  return response || cache.match(WATEROPS_INDEX);
}

async function cacheFirst(request) {
  const cache = await caches.open(WATEROPS_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) cache.put(request, response.clone());
  return response;
}
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
