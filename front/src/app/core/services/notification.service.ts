import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, Subject, tap, firstValueFrom, timeout, catchError, of } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ChatService } from './chat.service';
import { ConnectivityService } from './connectivity.service';
import { UserService } from './user.service';

export interface Notification {
    id: number;
    userId: number;
    type: 'MESSAGE' | 'MATCH' | 'SYSTEM';
    content: string;
    metadata: any;
    isRead: boolean;
    createdAt: Date;
}

@Injectable({
    providedIn: 'root'
})
export class NotificationService {
    private notificationsSubject = new BehaviorSubject<Notification[]>([]);
    public notifications$ = this.notificationsSubject.asObservable();

    private unreadCountSubject = new BehaviorSubject<number>(0);
    public unreadCount$ = this.unreadCountSubject.asObservable();

    private newNotificationSubject = new Subject<Notification>();
    public newNotification$ = this.newNotificationSubject.asObservable();

    private readonly VAPID_PUBLIC_KEY = 'BLWHpr2cyRKwtb6c3PCH2PhZYDzhCfq_U6PMxUoRrJUOFFsPQ_BYnaRQxLC8BzPbLYxlJx0WWmvi6BVUsjIXhcs';

    constructor(
        private http: HttpClient,
        private chatService: ChatService,
        private connectivityService: ConnectivityService,
        private userService: UserService
    ) {
        this.init();
    }

    private init() {
        this.chatService.connect();

        this.chatService.notifications$.subscribe((notification: Notification) => {
            this.handleNewNotification(notification);
        });

        this.loadNotifications().subscribe();
        this.loadUnreadCount();

        this.connectivityService.isOnline$.subscribe(online => {
            if (online) {
                this.loadNotifications().subscribe();
                this.loadUnreadCount();
            }
        });
    }

    private handleNewNotification(notification: Notification) {
        const current = this.notificationsSubject.value;
        const index = current.findIndex(n => n.id === notification.id);

        if (index > -1) {
            // Update existing (grouped notification)
            current[index] = notification;
            this.notificationsSubject.next([...current]);
        } else {
            // New one
            this.notificationsSubject.next([notification, ...current]);
        }

        // Always refresh unread count from server to ensure accuracy (esp. with grouping/un-grouping)
        this.loadUnreadCount();
        this.newNotificationSubject.next(notification);

        // Attempt to show system notification if app is in background
        this.attemptSystemNotification(notification);
    }

    private attemptSystemNotification(notification: Notification) {
        // Only show if the page is hidden (user doing something else)
        if (document.visibilityState === 'visible') {
            return;
        }

        // Check if browser supports notifications
        if (!('Notification' in window)) {
            return;
        }

        // Check permission
        if (Notification.permission !== 'granted') {
            return;
        }

        // Prepare title based on type
        let title = 'Reloke';
        if (notification.type === 'MESSAGE') {
            title = 'Nouveau message de ' + (notification.metadata?.senderName || 'un utilisateur');
        } else if (notification.type === 'MATCH') {
            title = 'Nouveau Match !';
        } else {
            title = 'Nouvelle notification';
        }

        // Create notification
        try {
            const sysNotification = new Notification(title, {
                body: notification.content || 'Vous avez une nouvelle notification',
                icon: 'assets/icons/icon-192x192.png', // Ensure this path exists or use a generic one
                tag: 'reloke-notification-' + notification.id,
                requireInteraction: false
            });

            // Handle click
            sysNotification.onclick = () => {
                window.focus();
                sysNotification.close();

                // Optional: Open specific chat if available
                if (notification.type === 'MESSAGE' || notification.type === 'MATCH') {
                    // Navigate logic via Router would require injecting Router if not already waiting.
                    // Or rely on the user just focusing the window.
                    // Ideally we could emit an event or navigate.
                }
            };
        } catch (e) {
            console.error('Error creating system notification', e);
        }
    }

    loadNotifications(page: number = 1, limit: number = 20) {
        return this.http.get<Notification[]>(`${environment.apiUrl}/notifications`, {
            params: { page: page.toString(), limit: limit.toString() }
        }).pipe(
            tap(notifications => {
                if (page === 1) {
                    this.notificationsSubject.next(notifications);
                }
            })
        );
    }

    loadUnreadCount() {
        this.http.get<number>(`${environment.apiUrl}/notifications/unread-count`).subscribe(
            count => this.unreadCountSubject.next(count)
        );
    }

    markAsRead(id: number) {
        return this.http.post(`${environment.apiUrl}/notifications/${id}/read`, {}).pipe(
            tap(() => {
                const current = this.notificationsSubject.value;
                const updated = current.map(n => n.id === id ? { ...n, isRead: true } : n);
                this.notificationsSubject.next(updated);
                this.loadUnreadCount();
            })
        );
    }

    deleteNotification(id: number) {
        return this.http.delete(`${environment.apiUrl}/notifications/${id}`).pipe(
            tap(() => {
                const current = this.notificationsSubject.value;
                const updated = current.filter(n => n.id !== id);
                this.notificationsSubject.next(updated);
                this.loadUnreadCount();
            })
        );
    }

    markAllAsRead(matchGroupId?: string) {
        this.http.post(`${environment.apiUrl}/notifications/mark-read`, { matchGroupId }).subscribe(() => {
            this.loadNotifications();
            this.loadUnreadCount();
        });
    }

    deleteAll() {
        return this.http.delete(`${environment.apiUrl}/notifications`).pipe(
            tap(() => {
                this.notificationsSubject.next([]);
                this.loadUnreadCount();
            })
        );
    }

    async subscribeToPush() {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
            console.warn('Push notifications are not supported by this browser.');
            return false;
        }

        try {
            const registration = await navigator.serviceWorker.ready;

            // Check if already subscribed
            let subscription = await registration.pushManager.getSubscription();

            if (!subscription) {
                // Subscribe
                subscription = await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: this.urlBase64ToUint8Array(this.VAPID_PUBLIC_KEY)
                });
            }

            // Send to backend
            const subscriptionPayload = subscription.toJSON();
            await firstValueFrom(
                this.http.post(`${environment.apiUrl}/notifications/subscribe`, subscriptionPayload).pipe(
                    timeout(5000),
                    catchError(err => {
                        console.error('Subscription backend call timed out or failed:', err);
                        return of(null);
                    })
                )
            );
            console.log('Successfully subscribed (or attempted) to push notifications');

            // Sync with backend user settings
            this.userService.updatePushSettings(true).subscribe({
                next: () => console.log('User push settings updated to true in backend'),
                error: (err) => console.error('Failed to update user push settings in backend', err)
            });

            return true;
        } catch (error) {
            console.error('Failed to subscribe to push notifications:', error);
            return false;
        }
    }

    isPushEnabled(): boolean {
        return 'Notification' in window && Notification.permission === 'granted';
    }

    private urlBase64ToUint8Array(base64String: string) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding)
            .replace(/\-/g, '+')
            .replace(/_/g, '/');

        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);

        for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
    }
}
