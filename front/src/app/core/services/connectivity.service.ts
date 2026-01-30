import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, fromEvent, merge, of, Subscription } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable({
    providedIn: 'root'
})
export class ConnectivityService implements OnDestroy {
    private isOnlineSubject = new BehaviorSubject<boolean>(navigator.onLine);
    public isOnline$ = this.isOnlineSubject.asObservable();

    private subscription: Subscription;

    constructor() {
        this.subscription = merge(
            of(navigator.onLine),
            fromEvent(window, 'online').pipe(map(() => true)),
            fromEvent(window, 'offline').pipe(map(() => false))
        ).subscribe(status => {
            if (this.isOnlineSubject.value !== status) {
                this.isOnlineSubject.next(status);
            }
        });
    }

    public get isOnline(): boolean {
        return this.isOnlineSubject.value;
    }

    ngOnDestroy() {
        this.subscription.unsubscribe();
    }
}
