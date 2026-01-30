import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';

import { ProfileRoutingModule } from './profile-routing.module';
import { ProfileLayoutComponent } from './components/profile-layout/profile-layout.component';
import { OutgoingProfileComponent } from './components/outgoing-profile/outgoing-profile.component';
import { SearcherProfileComponent } from './components/searcher-profile/searcher-profile.component';
import { TransactionsComponent } from './components/transactions/transactions.component';
import { HelpRequestComponent } from './components/help-request/help-request.component';

import { SharedModule } from '../shared/shared.module';

// PrimeNG Calendar
import { CalendarModule } from 'primeng/calendar';

@NgModule({
  declarations: [
    OutgoingProfileComponent,
    SearcherProfileComponent,
    TransactionsComponent,
    HelpRequestComponent
  ],
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ProfileRoutingModule,
    SharedModule,
    ProfileLayoutComponent,
    CalendarModule
  ]
})
export class ProfileModule { }
