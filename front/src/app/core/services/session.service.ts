import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

@Injectable({
    providedIn: 'root'
})
export class SessionService {
    private sessionExpiredSource = new Subject<void>();
    sessionExpired$ = this.sessionExpiredSource.asObservable();

    notifySessionExpired() {
        this.sessionExpiredSource.next();
    }
}
