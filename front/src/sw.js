// Service Worker for SwitchKey Web Push Notifications
self.addEventListener('push', (event) => {
    if (!(self.Notification && self.Notification.permission === 'granted')) {
        return;
    }

    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch (e) {
        console.error('Push event data is not JSON:', e);
    }

    const notification = data.notification || {};
    const title = notification.title || 'Reloke';
    const options = {
        body: notification.body || 'Nouveau message reçu',
        icon: notification.icon || '/assets/logo.png',
        badge: '/assets/logo.png',
        data: notification.data || {},
        vibrate: [100, 50, 100],
        requireInteraction: false
    };

    event.waitUntil(
        self.registration.showNotification(title, options)
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const data = event.notification.data || {};
    let targetUrl = '/';

    if (data.matchGroupId) {
        targetUrl = `/matching/chat/${data.matchGroupId}`;
    } else if (data.chatId) {
        targetUrl = `/matching/chat`;
    }

    // Use full URL to match existing windows
    const fullTargetUrl = new URL(targetUrl, self.location.origin).href;

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            // Try to find an existing window and focus it
            for (const client of clientList) {
                if (client.url === fullTargetUrl && 'focus' in client) {
                    return client.focus();
                }
            }
            // If no window found, open a new one
            if (clients.openWindow) {
                return clients.openWindow(fullTargetUrl);
            }
        })
    );
});
