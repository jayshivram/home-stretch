/* Home Stretch service worker.
 *
 * Same-origin requests are network first so a change to the app shows up on the
 * next load rather than being pinned to whatever was cached first. The cache is
 * the offline fallback. Google Fonts are the opposite: they never change under
 * a given URL, so they are served from cache and refreshed in the background.
 */
const SHELL_CACHE = 'home-stretch-shell-v1';
const FONT_CACHE = 'home-stretch-fonts-v1';
const KEEP = [SHELL_CACHE, FONT_CACHE];

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './script.js',
  './favicon.svg',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      // One bad URL should not fail the whole install, so each is added alone.
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isFontHost(hostname) {
  return hostname === 'fonts.googleapis.com' || hostname === 'fonts.gstatic.com';
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
    );
    return;
  }

  if (isFontHost(url.hostname)) {
    event.respondWith(
      caches.open(FONT_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        const network = fetch(req)
          .then((res) => { cache.put(req, res.clone()).catch(() => {}); return res; })
          .catch(() => hit);
        return hit || network;
      })
    );
  }
});
