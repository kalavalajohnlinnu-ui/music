// Sur Slot Service Worker (PWA Shell & Web Push Notification Handler)
const CACHE_NAME = 'sur-slot-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => {})
    .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter(len => len !== CACHE_NAME).map(k => caches.delete(k))))
    .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networked = fetch(event.request).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
        }
        return res;
      }).catch(() => cached);
      return cached || networked;
    })
  );
});

self.addEventListener('push', (event) => {
  let payload = {
    title: '匵 Sur Slot Class Reminder',
    body: 'You have an upcoming music class update!',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: 'sur-slot-class-reminder',
    data: { url: '/' }
  };
  if (event.data) {
    try {
      const json = event.data.json();
      payload = Object.assign(payload, json);
    } catch (e) {
      payload.body = event.data.text() || payload.body;
    }
  }
  const options = {
    body: payload.body,
    icon: payload.icon || '/icon-192.png',
    badge: payload.badge || '/icon-192.png',
    tag: payload.tag || 'sur-slot-notification',
    data: payload.data || { url: '/' },
    vibrate: [100, 50, 100, 50, 150],
    renotify: true,
    actions: [
      { action: 'open', title: '＼＾ Open Sur Slot' },
      { action: 'dismiss', title: '✕Dismiss' }
    ]
  };
  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  const targetUrl = (event.notification.data && event.notification.data.url) ? event.notification.data.url : '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});
