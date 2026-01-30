import { Component } from '@angular/core';

@Component({
  selector: 'app-match-feed',
  templateUrl: './match-feed.component.html',
  styleUrls: ['./match-feed.component.scss']
})
export class MatchFeedComponent {
  activeTab: 'potential' | 'confirmed' = 'potential';

  constructor() { }

  switchTab(tab: 'potential' | 'confirmed') {
    this.activeTab = tab;
  }
}
