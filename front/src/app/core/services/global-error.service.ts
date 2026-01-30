import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({
    providedIn: 'root'
})
export class GlobalErrorService {
    private isServerDownSubject = new BehaviorSubject<boolean>(false);
    public isServerDown$ = this.isServerDownSubject.asObservable();

    constructor() { }

    setServerDown(isDown: boolean) {
        this.isServerDownSubject.next(isDown);
    }

    retry() {
        this.isServerDownSubject.next(false);
        // Optionally trigger a reload or re-request logic if feasible, 
        // but for now we just clear the modal to let user try again manually.
    }
}
