import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { MatchFeedComponent } from './components/match-feed/match-feed.component';
import { ChatComponent } from './components/chat/chat.component';

import { SearchConfigComponent } from './components/search-config/search-config.component';
import { PaymentComponent } from './components/payment/payment.component';
import { ProfileLayoutComponent } from '../profile/components/profile-layout/profile-layout.component';

const routes: Routes = [
  {
    path: '',
    component: ProfileLayoutComponent,
    children: [
      { path: '', component: MatchFeedComponent },
      { path: 'feed', component: MatchFeedComponent },
      { path: 'config', component: SearchConfigComponent },
      { path: 'payment', component: PaymentComponent },
      { path: 'chat', component: ChatComponent },
      { path: 'chat/:matchGroupId', component: ChatComponent }

    ]
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class MatchingRoutingModule { }
