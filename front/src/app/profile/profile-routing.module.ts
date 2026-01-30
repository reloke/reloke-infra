import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { OutgoingProfileComponent } from './components/outgoing-profile/outgoing-profile.component';
import { SearcherProfileComponent } from './components/searcher-profile/searcher-profile.component';
import { ProfileLayoutComponent } from './components/profile-layout/profile-layout.component';
import { SecuritySettingsComponent } from './components/security-settings/security-settings.component';
import { DataPrivacyComponent } from './components/data-privacy/data-privacy.component';
import { AccountManagementComponent } from './components/account-management/account-management.component';
import { AccountComponent } from './components/account/account.component';
import { TransactionsComponent } from './components/transactions/transactions.component';
import { NotificationsComponent } from './components/notifications/notifications.component';
import { HelpRequestComponent } from './components/help-request/help-request.component';

const routes: Routes = [
  {
    path: '',
    component: ProfileLayoutComponent,
    children: [
      {
        path: '',
        // This makes AccountManagementComponent the default for '/profile'
        component: AccountManagementComponent,
        children: [
          // Redirect empty path to the first tab
          { path: '', redirectTo: '/profile/account', pathMatch: 'full' },
          // The tab content components
          { path: 'account', component: AccountComponent },
          { path: 'security', component: SecuritySettingsComponent },
          { path: 'privacy', component: DataPrivacyComponent },
        ]
      },
      { path: 'outgoing', component: OutgoingProfileComponent },
      { path: 'searcher', component: SearcherProfileComponent },
      { path: 'transactions', component: TransactionsComponent },
      { path: 'notifications', component: NotificationsComponent },
      { path: 'help', component: HelpRequestComponent }
    ]
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class ProfileRoutingModule { }
