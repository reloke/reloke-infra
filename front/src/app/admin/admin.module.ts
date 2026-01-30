import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { AdminRoutingModule } from './admin-routing.module';
import { AdminDashboardComponent } from './components/admin-dashboard/admin-dashboard.component';
import { UserListComponent } from './components/user-list/user-list.component';

import { FormsModule } from '@angular/forms';
import { OverviewComponent } from './components/overview/overview.component';
import { VerificationsComponent } from './components/verifications/verifications.component';

import { AdminInfluencersComponent } from './components/admin-influencers/admin-influencers.component';
import { AdminReportsComponent } from './components/admin-reports/admin-reports.component';
import { AdminHelpComponent } from './components/admin-help/admin-help.component';
import { SharedModule } from '../shared/shared.module';

@NgModule({
  declarations: [
    AdminDashboardComponent,
    UserListComponent,
    AdminInfluencersComponent,
    AdminReportsComponent,
    AdminHelpComponent
  ],
  imports: [
    CommonModule,
    AdminRoutingModule,
    FormsModule,
    SharedModule,
    OverviewComponent,
    VerificationsComponent
  ]
})
export class AdminModule { }
