import { Component } from '@angular/core';
import { PaymentService } from '../../../core/services/payment.service';

@Component({
  selector: 'app-subscription',
  templateUrl: './subscription.component.html',
  styleUrls: ['./subscription.component.scss']
})
export class SubscriptionComponent {
  constructor(private paymentService: PaymentService) { }

  onSubscribe(amount: number, packId: string) {
    this.paymentService.createOrder(amount, packId).subscribe({
      next: (res) => {
        if (res.approvalUrl) {
          window.location.href = res.approvalUrl;
        } else {
          alert('Erreur: URL de paiement non reçue.');
        }
      },
      error: (err) => {
        console.error(err);
        alert('Erreur lors de la création de la commande. Veuillez réessayer.');
      }
    });
  }
}
