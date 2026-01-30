import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';

@Component({
    selector: 'app-search-config',
    templateUrl: './search-config.component.html',
    styleUrls: ['./search-config.component.scss']
})
export class SearchConfigComponent implements OnInit {
    duration = 30;
    matches = 5;
    totalPrice = 25; // 5 * 5
    isLoading = false;
    message: string | null = null;

    constructor(private router: Router) { }

    ngOnInit() {
        this.updatePrice();
    }

    updatePrice() {
        this.totalPrice = this.matches * 5;
    }

    payWithPayPal() {
        this.isLoading = true;
        this.message = null;

        // Simulation
        setTimeout(() => {
            this.isLoading = false;
            this.message = 'Paiement réussi ! Redirection...';
            setTimeout(() => {
                // Navigate to match feed or dashboard
                this.router.navigate(['/matching/feed']);
            }, 1500);
        }, 2000);
    }
}
