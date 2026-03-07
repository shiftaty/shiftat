// ╔══════════════════════════════════════════════════════════════╗
// ║           SHIFTATY — Service Worker v3.0                    ║
// ║  يحمي البيانات من "Clear Browsing Data" بشكل كامل          ║
// ╚══════════════════════════════════════════════════════════════╝

const APP_CACHE    = 'shiftaty-app-v3';
const DATA_CACHE   = 'shiftaty-data-v3';   // ← البيانات هنا لا تُمسح بالـ clear العادي
const DATA_PREFIX  = 'https://shiftaty.app/__data__/';

// ── ملفات التطبيق الأساسية للـ offline ──
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
];

// ══════════════════════════════════════════════════════════════
// INSTALL — cache ملفات التطبيق
// ══════════════════════════════════════════════════════════════
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(APP_CACHE).then(cache => {
      return cache.addAll(APP_SHELL).catch(() => {
        // لو فشل أي ملف، متوقفش — استمر
      });
    })
  );
});

// ══════════════════════════════════════════════════════════════
// ACTIVATE — احذف الـ caches القديمة وخد السيطرة فوراً
// ══════════════════════════════════════════════════════════════
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== APP_CACHE && k !== DATA_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ══════════════════════════════════════════════════════════════
// FETCH — التحكم في كل الطلبات
// ══════════════════════════════════════════════════════════════
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // ── 1) طلبات حفظ/جلب البيانات — DATA_CACHE (الأهم) ──
  if (url.startsWith(DATA_PREFIX)) {
    event.respondWith(handleDataRequest(event.request));
    return;
  }

  // ── 2) ملفات التطبيق — Cache First ──
  if (event.request.method === 'GET') {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(APP_CACHE).then(c => c.put(event.request, clone));
          }
          return response;
        }).catch(() => caches.match('./index.html'));
      })
    );
  }
});

// ══════════════════════════════════════════════════════════════
// handleDataRequest — حفظ وجلب البيانات من DATA_CACHE
// ══════════════════════════════════════════════════════════════
async function handleDataRequest(request) {
  const cache = await caches.open(DATA_CACHE);

  if (request.method === 'GET') {
    const cached = await cache.match(request);
    return cached || new Response('null', {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (request.method === 'PUT' || request.method === 'POST') {
    const body = await request.text();
    const response = new Response(body, {
      headers: { 'Content-Type': 'application/json' }
    });
    await cache.put(request.url, response);
    return new Response('ok', { status: 200 });
  }

  if (request.method === 'DELETE') {
    await cache.delete(request.url);
    return new Response('ok', { status: 200 });
  }

  return new Response('method not allowed', { status: 405 });
}

// ══════════════════════════════════════════════════════════════
// MESSAGE — استقبال رسائل من التطبيق
// ══════════════════════════════════════════════════════════════
self.addEventListener('message', async event => {
  const { type, payload } = event.data || {};

  // طلب حفظ البيانات مباشرة عبر message (بديل للـ fetch)
  if (type === 'SAVE_DATA') {
    try {
      const cache = await caches.open(DATA_CACHE);
      await Promise.all(
        Object.entries(payload).map(([key, value]) =>
          cache.put(
            DATA_PREFIX + key,
            new Response(
              typeof value === 'string' ? value : JSON.stringify(value),
              { headers: { 'Content-Type': 'application/json' } }
            )
          )
        )
      );
      event.ports[0]?.postMessage({ ok: true });
    } catch(e) {
      event.ports[0]?.postMessage({ ok: false, error: e.message });
    }
    return;
  }

  // طلب جلب كل البيانات
  if (type === 'GET_ALL_DATA') {
    try {
      const cache = await caches.open(DATA_CACHE);
      const keys  = await cache.keys();
      const result = {};
      await Promise.all(
        keys.map(async req => {
          const k    = req.url.replace(DATA_PREFIX, '');
          const resp = await cache.match(req);
          if (resp) result[k] = await resp.text();
        })
      );
      event.ports[0]?.postMessage({ ok: true, data: result });
    } catch(e) {
      event.ports[0]?.postMessage({ ok: false, data: {} });
    }
    return;
  }

  // طلب مسح كل البيانات (للـ reset المتعمد فقط)
  if (type === 'CLEAR_DATA') {
    try {
      await caches.delete(DATA_CACHE);
      event.ports[0]?.postMessage({ ok: true });
    } catch(e) {
      event.ports[0]?.postMessage({ ok: false });
    }
    return;
  }

  // طلب تخطي الانتظار (تحديث فوري)
  if (type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
});
