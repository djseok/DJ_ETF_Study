// 📱 대시보드 앱(PWA) 서비스워커
// - 항상 인터넷에서 최신을 먼저 받고(network-first), 안 되면 마지막으로 받아둔 것을 보여줍니다
// - 구글 시트 CSV 는 주소 끝의 &t=시각 을 빼고 저장 → 오프라인이어도 마지막 데이터로 열림
// - 디자인·차트 라이브러리(CDN)는 저장본을 먼저 쓰고 뒤에서 갱신
// - 코드를 바꿔도 network-first 라 바로 반영됩니다 (버전 올릴 필요 없음)
const CACHE = 'dj-etf-v1';
const SHELL = ['./', 'index.html', 'css/style.css', 'manifest.webmanifest', 'assets/icons/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

function cacheKey(req) {
  const u = new URL(req.url);
  u.searchParams.delete('t');
  return u.toString();
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  const isSheet = u.hostname === 'docs.google.com' && u.pathname.includes('/pub');
  const sameOrigin = u.origin === self.location.origin;
  const isCdn = /(^|\.)(cdn\.tailwindcss\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com)$/.test(u.hostname);
  if (isCdn) { // 디자인·차트 라이브러리: 저장본을 바로 쓰고 뒤에서 새로 받아둠
    e.respondWith(caches.open(CACHE).then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(res => { if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  if (!isSheet && !sameOrigin) return; // 가격 서버 등은 브라우저 기본 동작
  e.respondWith((async () => {
    const key = cacheKey(req);
    try {
      const res = await fetch(req);
      if (res && (res.ok || res.type === 'opaque')) {
        const c = await caches.open(CACHE);
        c.put(key, res.clone());
      }
      return res;
    } catch (err) {
      const hit = await caches.match(key);
      if (hit) return hit;
      if (req.mode === 'navigate') return caches.match('index.html');
      throw err;
    }
  })());
});
