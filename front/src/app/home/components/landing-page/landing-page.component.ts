import { isPlatformBrowser } from '@angular/common';
import { AfterViewInit, Component, HostListener, Inject, OnInit, PLATFORM_ID } from '@angular/core';

@Component({
  selector: 'app-landing-page',
  templateUrl: './landing-page.component.html',
  styleUrls: ['./landing-page.component.scss']
})
export class LandingPageComponent implements OnInit, AfterViewInit {
  isMenuOpen = false;
  scrolled = false;
  private readonly isBrowser: boolean;

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


faqItems = [
  {
    question: "C’est quoi Reloke, concrètement ?",
    answer: "Reloke met en relation des locataires qui vont quitter leur logement avec d’autres locataires qui cherchent dans la même zone. Vous matchez, puis vous échangez directement pour organiser la suite.",
    isOpen: false
  },
  {
    question: "Est-ce que Reloke me garantit un logement ?",
    answer: "Non. Reloke vous aide à trouver des personnes compatibles, mais le logement dépend ensuite de l’accord du bailleur/propriétaire et de votre dossier.",
    isOpen: false
  },
  {
    question: "Qu’est-ce que je vois avant et après un match ?",
    answer: "Avant match, vous ne voyez aucune info personnelle des autres. Après match, vous voyez les infos du logement sortant et vous pouvez discuter via le chat.",
    isOpen: false
  },
  {
    question: "Combien ça coûte ?",
    answer: "L’inscription est gratuite. Pour entrer dans le flux de matching, vous achetez un pack de matchs : 12€ HT (2 matchs), 25€ HT (5 matchs), 60€ HT (15 matchs).",
    isOpen: false
  },
  {
    question: "Et si je veux arrêter ou me faire rembourser ?",
    answer: "Vous pouvez arrêter quand vous voulez. Les matchs non utilisés peuvent être remboursés au prorata directement depuis votre compte.",
    isOpen: false
  }
];


  constructor(@Inject(PLATFORM_ID) platformId: object) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  ngOnInit() {
    if (this.isBrowser) this.checkScroll();
  }

  ngAfterViewInit() {
    if (this.isBrowser) this.restoreScrollPosition();
  }

  @HostListener('window:scroll', [])
  onWindowScroll() {
    if (!this.isBrowser) return;
    this.checkScroll();
    this.saveScrollPosition();
  }

  checkScroll() {
    if (!this.isBrowser) return;
    this.scrolled = window.scrollY > 20;
  }

  toggleMenu() {
    this.isMenuOpen = !this.isMenuOpen;
  }

  closeMenu() {
    this.isMenuOpen = false;
  }

  toggleFaq(index: number) {
    this.faqItems[index].isOpen = !this.faqItems[index].isOpen;
  }

  private saveScrollPosition() {
    if (!this.isBrowser) return;
    try {
      localStorage.setItem('landingPageScrollY', window.scrollY.toString());
    } catch {}
  }

  private restoreScrollPosition() {
    if (!this.isBrowser) return;
    let savedScrollY: string | null = null;
    try {
      savedScrollY = localStorage.getItem('landingPageScrollY');
    } catch {}
    if (savedScrollY) {
      setTimeout(() => {
        window.scrollTo({
          top: parseInt(savedScrollY, 10),
          behavior: 'smooth'
        });
      }, 100); // Small delay to ensure page is rendered
    }
  }
}

