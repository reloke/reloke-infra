import { Component, Input, Output, EventEmitter } from '@angular/core';
import { MatchIntent, MatchItem } from '../../services/matching.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-match-card',
  templateUrl: './match-card.component.html',
  styleUrls: ['./match-card.component.scss']
})
export class MatchCardComponent {
  @Input() match?: MatchIntent;
  @Input() confirmedMatch?: MatchItem;
  @Output() request = new EventEmitter<void>();

  constructor(private router: Router) { }

  onRequest(event: Event) {
    event.stopPropagation();
    this.request.emit();
  }

  onChat(event?: Event) {
    if (event) event.stopPropagation();
    if (this.confirmedMatch?.groupId) {
      this.router.navigate(['/matching/chat', this.confirmedMatch.groupId]);
    } else {
      this.router.navigate(['/matching/chat']);
    }
  }

  viewDetails() {
    if (this.confirmedMatch) {
      this.router.navigate(['/matches', this.confirmedMatch.id]);
    } else if (this.match) {
      this.router.navigate(['/matching', this.match.id]);
    }
  }
}
