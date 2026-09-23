/* 오늘 나가? — 앱 껍데기는 캐시, 날씨는 항상 네트워크 */
const CACHE = 'oneul-v1';
const SHELL = [
  './', './index.html', './styles.css', './core.js', './app.js',
  './manifest.webmanifest', './data/oreum.json',
  './vendor/leaflet.js', './vendor/leaflet.css',
  './vendor/images/marker-icon.png', './vendor/images/layers.png', './vendor/images/layers-2x.png',
  './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  // 지도 타일은 앱이 IndexedDB로 직접 관리한다 — 여기서 건드리지 않는다
  if (url.hostname.endsWith('tile.openstreetmap.org')) return;

  // 날씨·조석은 항상 새로 받되, 실패하면 앱이 저장해둔 값을 쓴다
  if (url.hostname.endsWith('open-meteo.com')) return;

  if (url.origin !== location.origin) return;

  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
