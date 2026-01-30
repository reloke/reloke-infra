import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AdminDashboardComponent } from './components/admin-dashboard/admin-dashboard.component';
import { UserListComponent } from './components/user-list/user-list.component';
import { OverviewComponent } from './components/overview/overview.component';
import { VerificationsComponent } from './components/verifications/verifications.component';
import { AdminInfluencersComponent } from './components/admin-influencers/admin-influencers.component';
import { AdminReportsComponent } from './components/admin-reports/admin-reports.component';
import { AdminHelpComponent } from './components/admin-help/admin-help.component';
import { AdminUserDetailComponent } from './components/admin-user-detail/admin-user-detail.component';
import { ActionLogsComponent } from './components/logs/logs.component';

const routes: Routes = [
  {
    path: 'dashboard',
    component: AdminDashboardComponent,
    children: [
      { path: '', redirectTo: 'overview', pathMatch: 'full' },
      { path: 'overview', component: OverviewComponent },
      { path: 'users', component: UserListComponent },
      { path: 'users/:userUid', component: AdminUserDetailComponent },
      { path: 'verifications', component: VerificationsComponent },
      { path: 'influencers', component: AdminInfluencersComponent },
      { path: 'reports', component: AdminReportsComponent },
      { path: 'help', component: AdminHelpComponent },
      { path: 'logs', component: ActionLogsComponent }
    ]
  },
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class AdminRoutingModule { }
