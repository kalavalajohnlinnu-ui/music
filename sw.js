// International Thomas Music Academy (ITMA) Service Worker
const CACHE_NAME = 'itma-spatial-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.json',
  '/logo.png',
  '/itma-logo.png',
  '/icon-192.png',
  '/icon-512.png',
  '/favicon.png',
  '/alarm.mp3'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => {})
    .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
    .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;

  // For HTML documents & page navigations: Network-First with offline.html fallback
  if (event.request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(event.request).then((res) => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
        }
        return res;
      }).catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        return caches.match('/offline.html');
      })
    );
    return;
  }

  // For static images/icons: Stale-while-revalidate
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networked = fetch(event.request).then((res) => {
        if (res && res.status === 200) {
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
    title: '🎵 Music Class Reminder',
    body: 'You have an upcoming music class update!',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: 'music-slot-reminder',
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

  const defaultActions = [
    { action: 'open', title: 'Open App' },
    { action: 'dismiss', title: '✕ Dismiss' }
  ];

  const options = {
    body: payload.body,
    icon: payload.icon || '/icon-192.png',
    badge: payload.badge || '/icon-192.png',
    tag: payload.tag || 'music-slot-notification',
    data: payload.data || { url: '/' },
    vibrate: payload.vibrate || [300, 100, 300, 100, 300],
    requireInteraction: payload.requireInteraction !== undefined ? payload.requireInteraction : true,
    renotify: true,
    actions: payload.actions || defaultActions
  };
  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const notifData = event.notification.data || {};
  const { dateKey, studentId } = notifData;

  // Background One-Tap Attendance Check-In (without needing to open app)
  if (event.action === 'mark_present' && studentId && dateKey) {
    event.waitUntil(
      fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: dateKey, studentId: studentId, status: 'present' })
      }).catch(err => console.error('Background attendance present error:', err))
    );
    return;
  }

  if (event.action === 'mark_absent' && studentId && dateKey) {
    event.waitUntil(
      fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: dateKey, studentId: studentId, status: 'absent' })
      }).catch(err => console.error('Background attendance absent error:', err))
    );
    return;
  }

  if (event.action === 'dismiss') return;

  const targetUrl = notifData.url || '/';
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
