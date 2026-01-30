import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { LoginComponent } from './components/login/login.component';
import { RegisterComponent } from './components/register/register.component';
import { VerifyEmailComponent } from './components/verify-email/verify-email.component';
import { ForgotPasswordComponent } from './components/forgot-password/forgot-password.component';
import { ResetPasswordComponent } from './components/reset-password/reset-password.component';
import { GoogleSuccessComponent } from './components/google-callback/google-success.component';
import { GoogleErrorComponent } from './components/google-callback/google-error.component';

import { GuestGuard } from '../core/guards/guest.guard';

import { AcceptCguComponent } from './components/accept-cgu/accept-cgu.component';

const routes: Routes = [
  { path: 'login', component: LoginComponent, canActivate: [GuestGuard], data: { seo: 'login' } },
  { path: 'register', component: RegisterComponent, canActivate: [GuestGuard], data: { seo: 'register' } },
  { path: 'accept-cgu', component: AcceptCguComponent, canActivate: [GuestGuard] },
  { path: 'verify-email', component: VerifyEmailComponent },
  { path: 'forgot-password', component: ForgotPasswordComponent, canActivate: [GuestGuard] },
  { path: 'reset-password', component: ResetPasswordComponent },
  { path: 'google/success', component: GoogleSuccessComponent },
  { path: 'google/error', component: GoogleErrorComponent },
  { path: '', redirectTo: 'login', pathMatch: 'full' }
];


@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class AuthRoutingModule { }
