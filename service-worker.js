const WATEROPS_CACHE = 'waterops-app-v2026-05-03-02';
const WATEROPS_CORE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/apple-touch-icon.png',
  '/apple-touch-icon-dark.png',
  '/icon-512.png',
  '/icon-512-dark.png'
];
const WATEROPS_CDN_ASSETS = [
  'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
  'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
  'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js'
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
      event.respondWith(networkFirst(request, '/index.html'));
      return;
    }
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  if (WATEROPS_CDN_ASSETS.includes(request.url)) {
    event.respondWith(cacheFirst(request));
  }
});

async function networkFirst(request, fallbackUrl = '/index.html') {
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
  return response || cache.match('/index.html');
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
