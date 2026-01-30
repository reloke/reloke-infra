import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ConnectivityService } from '../../../core/services/connectivity.service';
import { GlobalErrorService } from '../../../core/services/global-error.service';
import { combineLatest, Subscription } from 'rxjs';

@Component({
    selector: 'app-global-status',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './global-status.component.html',
    styles: [] // Using Tailwind classes in HTML
})
export class GlobalStatusComponent implements OnInit, OnDestroy {
    isOffline = false;
    isServerDown = false;
    private sub: Subscription | undefined;

    constructor(
        private connectivityService: ConnectivityService,
        private globalErrorService: GlobalErrorService
    ) { }

    ngOnInit() {
        this.sub = combineLatest([
            this.connectivityService.isOnline$,
            this.globalErrorService.isServerDown$
        ]).subscribe(([isOnline, isServerDown]) => {
            this.isOffline = !isOnline;
            this.isServerDown = isServerDown;
        });
    }

    ngOnDestroy() {
        if (this.sub) this.sub.unsubscribe();
    }

    retryServer() {
        this.globalErrorService.retry();
    }
}
