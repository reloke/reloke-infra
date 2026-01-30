import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';

import { HomeRoutingModule } from './home-routing.module';
import { LandingPageComponent } from './components/landing-page/landing-page.component';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { MatchDetailsComponent } from './components/match-details/match-details.component';
import { PricingComponent } from './components/pricing/pricing.component';
import { FaqComponent } from './components/faq/faq.component';
import { ContactComponent } from './components/contact/contact.component';
import { MatchingModule } from '../matching/matching.module';
import { NotificationPermissionPromptComponent } from '../core/notifications/notification-permission-prompt/notification-permission-prompt.component';
import { OnboardingTimelineComponent } from './components/onboarding-timeline/onboarding-timeline.component';

import { SharedModule } from '../shared/shared.module';

@NgModule({
  declarations: [
    LandingPageComponent,
    DashboardComponent,
    MatchDetailsComponent,
    PricingComponent,
    FaqComponent,
    ContactComponent
  ],
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    HomeRoutingModule,
    SharedModule,
    MatchingModule,
    NotificationPermissionPromptComponent,
    OnboardingTimelineComponent
  ]
})
export class HomeModule { }
