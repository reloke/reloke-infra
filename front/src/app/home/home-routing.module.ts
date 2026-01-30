import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { LandingPageComponent } from './components/landing-page/landing-page.component';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { MatchDetailsComponent } from './components/match-details/match-details.component';
import { PricingComponent } from './components/pricing/pricing.component';
import { FaqComponent } from './components/faq/faq.component';
import { ContactComponent } from './components/contact/contact.component';
import { AuthGuard } from '../core/guards/auth.guard';
import { ProfileLayoutComponent } from '../profile/components/profile-layout/profile-layout.component';
import { GuestGuard } from '../core/guards/guest.guard';
import { UserGuard } from '../core/guards/user.guard';



const routes: Routes = [
  { path: '', component: LandingPageComponent, canActivate: [GuestGuard], pathMatch: 'full', data: { seo: 'home' } },
  { path: 'tarif', component: PricingComponent, data: { seo: 'pricing' } },
  { path: 'faq', component: FaqComponent, data: { seo: 'faq' } },
  { path: 'contact', component: ContactComponent, data: { seo: 'contact' } },
  {
    path: '',
    component: ProfileLayoutComponent,
    canActivate: [AuthGuard, UserGuard],
    children: [
      { path: 'dashboard', component: DashboardComponent },
      { path: 'matches/:uid', component: MatchDetailsComponent },

    ],
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class HomeRoutingModule { }
