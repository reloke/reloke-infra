import { Component } from '@angular/core';

@Component({
    selector: 'app-faq',
    templateUrl: './faq.component.html',
    styleUrls: ['./faq.component.scss']
})
export class FaqComponent {

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


    toggleFaq(index: number) {
        this.faqItems[index].isOpen = !this.faqItems[index].isOpen;
    }
}
