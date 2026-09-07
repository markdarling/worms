// Worms: Armistice service worker — web-push "your turn" notifications.
// Registered by resources/js/game/notify.js once the player grants
// notification permission on a seat link.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; } catch { /* ignore */ }
    const title = data.title || 'Worms: Armistice';
    event.waitUntil(self.registration.showNotification(title, {
        body: data.body || 'It’s your turn.',
        tag: data.tag || 'worms-your-turn',
        icon: new URL('favicon.ico', self.registration.scope).href,
        badge: new URL('favicon.ico', self.registration.scope).href,
        data: { url: data.url || self.registration.scope },
    }));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = (event.notification.data && event.notification.data.url) || self.registration.scope;
    event.waitUntil((async () => {
        const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const w of wins) {
            // Already have the game open? Focus it.
            if (w.url === url && 'focus' in w) return w.focus();
        }
        return self.clients.openWindow(url);
    })());
});
