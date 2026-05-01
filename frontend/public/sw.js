// Service worker for Authentic Vintage Warehouse PWA
// Update CACHE_VERSION when deploying a new build to bust stale shell assets.
const CACHE_VERSION = 'v1';
const SHELL_CACHE = `av-shell-${CACHE_VERSION}`;
const MEDIA_CACHE = 'av-media'; // intentionally unversioned — uploaded files are immutable

// Seed the cache on install so the app shell is available offline immediately.
const SHELL_SEED = ['/', '/manifest.json', '/icons/icon.svg', '/icons/icon-maskable.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // allSettled so a single 404 doesn't abort the whole install
      Promise.allSettled(SHELL_SEED.map((url) => cache.add(url)))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith('av-shell-') && k !== SHELL_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin GET requests.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // API calls — always go to the network; never serve stale data.
  if (url.pathname.startsWith('/api/')) return;

  // Uploaded media — immutable once written, so serve from cache when available.
  if (url.pathname.startsWith('/uploads/')) {
    event.respondWith(cacheFirst(request, MEDIA_CACHE));
    return;
  }

  // Next.js content-hashed bundles — safe to cache indefinitely.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }

  // Pages and everything else — network first so fresh HTML is always preferred,
  // with a cache fallback so the app opens offline.
  event.respondWith(networkFirst(request, SHELL_CACHE));
});

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    // Last resort for navigation — return the cached root shell.
    if (request.mode === 'navigate') {
      const cache = await caches.open(cacheName);
      const root = await cache.match('/');
      if (root) return root;
    }
    return new Response('Offline — server unreachable', { status: 503 });
  }
}
