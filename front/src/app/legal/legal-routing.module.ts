import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { FaqComponent } from './components/faq/faq.component';
import { CguComponent } from './components/cgu/cgu.component';
import { ContactComponent } from './components/contact/contact.component';
import { PolicyComponent } from './components/policy/policy.component';

const routes: Routes = [
  { path: 'faq', component: FaqComponent },
  { path: 'terms-and-conditions', component: CguComponent },
  { path: 'contact', component: ContactComponent },
  { path: 'privacy-policy', component: PolicyComponent },
  { path: '', redirectTo: 'faq', pathMatch: 'full' }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class LegalRoutingModule { }
