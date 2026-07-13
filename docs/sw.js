// =====================================================================
// sw.js — Service Worker。
// アプリシェルと Pyodide（CDN）をキャッシュし、2回目以降の[実行]を
// オフラインでも動かす（§8-6）。API（POST）は一切キャッシュしない。
// =====================================================================

const SHELL_CACHE = 'dojo-shell-v33';
const PYODIDE_CACHE = 'dojo-pyodide-v1';

const SHELL_FILES = [
  './', 'index.html', 'style.css', 'app.js', 'api.js', 'runner.js', 'tools.js',
  'worker.js', 'zt.js', 'config.js', 'manifest.json', 'icon-192.png', 'icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // 1ファイル欠けても全体を失敗させない（ローカル開発時は config.js が無い等）
      Promise.allSettled(SHELL_FILES.map((f) => cache.add(f)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  // 古い版のキャッシュを掃除（キャッシュ名のv番号を上げたら旧版は消える）
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== SHELL_CACHE && k !== PYODIDE_CACHE)
        .map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // GAS APIへのPOSTは常にネットワーク（採点・出題は通信必須 §8-5）
  if (event.request.method !== 'GET') return;

  // Pyodide CDN: キャッシュ優先 → なければ取得してキャッシュ（オフライン実行の要）
  if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(cacheFirst(PYODIDE_CACHE, event.request));
    return;
  }

  // 自分のアプリシェル: キャッシュ優先（更新はキャッシュ名の版上げで配る）
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(SHELL_CACHE, event.request));
  }
});

async function cacheFirst(cacheName, request) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}
