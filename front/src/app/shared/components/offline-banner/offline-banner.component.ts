import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ConnectivityService } from '../../../core/services/connectivity.service';
import { Subscription } from 'rxjs';

@Component({
    selector: 'app-offline-banner',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './offline-banner.component.html',
    styleUrls: ['./offline-banner.component.scss']
})
export class OfflineBannerComponent implements OnInit, OnDestroy {
    isOnline = true;
    private connectivityService = inject(ConnectivityService);
    private subscription?: Subscription;

    ngOnInit(): void {
        this.subscription = this.connectivityService.isOnline$.subscribe((status: boolean) => {
            this.isOnline = status;
        });
    }

    ngOnDestroy(): void {
        if (this.subscription) {
            this.subscription.unsubscribe();
        }
    }
}
