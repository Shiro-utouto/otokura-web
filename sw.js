// オフラインでも開けるようにするための仕組み（Service Worker）
// アプリのファイルは「保存してあるものをすぐ使い、裏で新しいものを取ってくる」。次に開いたときに新しい版になる
// ファイルを足したら APP_FILES に足し、VERSION を上げる
const VERSION = 'otokura-web-v10';
const APP_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/main.js',
  './js/db.js',
  './js/store.js',
  './js/player.js',
  './js/importer.js',
  './js/tags.js',
  './js/mp4audio.js',
  './js/image.js',
  './js/lrc.js',
  './js/karaoke.js',
  './js/lrclib.js',
  './js/titleCleaner.js',
  './js/localFiles.js',
  './js/zip.js',
  './js/backup.js',
  './js/bookmarks.js',
  './js/ui/dom.js',
  './js/ui/common.js',
  './js/ui/library.js',
  './js/ui/nowplaying.js',
  './js/ui/lyricsTools.js',
  './js/ui/browser.js',
  './js/ui/settings.js',
  './js/ui/install.js',
  './js/ui/feel.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(VERSION)
      // GitHub Pages の10分のキャッシュを通さず、必ず新しいファイルを取る
      .then((c) => c.addAll(APP_FILES.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // 歌詞の検索など、よそのサイトへの通信には手を出さない
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const key = req.mode === 'navigate' ? './index.html' : req;
      const cached = await cache.match(key, { ignoreSearch: true });
      const fresh = fetch(req)
        .then((res) => {
          if (res.ok && res.type === 'basic') cache.put(key, res.clone());
          return res;
        })
        .catch(() => null);
      if (cached) {
        e.waitUntil(fresh);
        return cached;
      }
      return (await fresh) || new Response('オフラインです', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }),
  );
});
