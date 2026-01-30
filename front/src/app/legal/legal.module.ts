import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LegalRoutingModule } from './legal-routing.module';
import { SharedModule } from '../shared/shared.module';
import { FaqComponent } from './components/faq/faq.component';
import { CguComponent } from './components/cgu/cgu.component';
import { ContactComponent } from './components/contact/contact.component';

@NgModule({
  declarations: [
    FaqComponent,
    CguComponent,
    ContactComponent
  ],
  imports: [
    CommonModule,
    LegalRoutingModule,
    SharedModule
  ]
})
export class LegalModule { }
