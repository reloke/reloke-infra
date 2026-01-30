import { Component } from '@angular/core';

@Component({
    selector: 'app-pricing',
    templateUrl: './pricing.component.html',
    styleUrls: ['./pricing.component.scss']
})
export class PricingComponent {
    MATCH_PACKS = [
        {
            planType: 'PACK_DISCOVERY',
            label: 'Le Curieux',
            credits: 2,
            baseAmount: 12.0,
            pricePerMatch: '6€ / contact',
            description: 'Pour tester le matching sans engagement.',
            isRecommended: false,
        },
        {
            planType: 'PACK_STANDARD',
            label: "L'Efficace",
            credits: 5,
            baseAmount: 25.0,
            pricePerMatch: '5€ / contact',
            description: "Le volume idéal pour dynamiser votre recherche.",
            isRecommended: true,
        },
        {
            planType: 'PACK_PRO',
            label: 'Le Déterminé',
            credits: 15,
            baseAmount: 60.0,
            pricePerMatch: '4€ / contact',
            description: 'Pour maximiser vos chances de connexion.',
            isRecommended: false,
        },
    ];

    COMMON_FEATURES = [
        'Profils 100% vérifiés (Identité + DossierFacile)',
        'Support membre prioritaire',
        'Crédits non utilisés ? Remboursés.',
        'Accès illimité au chat après match'
    ];
}
