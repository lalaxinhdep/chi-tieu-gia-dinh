// Service worker: cho app mở được khi không có mạng và cài được như app trên điện thoại.
// Không bao giờ gửi dữ liệu đi; chỉ lưu đệm mã của app và các thư viện đã ghim phiên bản.
const VERSION = 'ctgd-v6';
const SHELL = [
  './', 'index.html', 'app.css', 'manifest.webmanifest',
  'js/app.js', 'js/util.js', 'js/crypto.js', 'js/idb.js', 'js/store.js', 'js/classify.js', 'js/reports.js',
  'js/loans.js', 'js/loans-ui.js', 'js/ocr.js',
  'js/parsers/index.js', 'js/parsers/pdf-text.js', 'js/parsers/pdf-layout.js', 'js/parsers/image.js',
  'js/parsers/techcombank-account.js', 'js/parsers/techcombank-credit.js', 'js/parsers/excel-generic.js', 'js/parsers/vib-credit.js',
  'icons/icon-192.png', 'icons/icon-512.png',
];
const LIB_HOSTS = ['cdn.jsdelivr.net', 'cdn.sheetjs.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Thư viện đã ghim phiên bản: lấy từ bộ đệm trước.
  if (LIB_HOSTS.includes(url.hostname)) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      })),
    );
    return;
  }

  // Mã của app: lấy bản mới nếu có mạng, không có mạng thì dùng bản đã lưu.
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req).then((hit) => hit || caches.match('index.html'))),
    );
  }
});
