import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { PromoCodeInputComponent } from './components/promo-code-input/promo-code-input.component';
import { ConfirmationModalComponent } from './components/confirmation-modal/confirmation-modal.component';
import { AlertComponent } from './components/alert/alert.component';
import { SessionTimeoutModalComponent } from './components/session-timeout-modal/session-timeout-modal.component';
import { PasswordStrengthFieldComponent } from './components/password-strength-field/password-strength-field.component';

import { LogoutButtonComponent } from './components/logout-button/logout-button.component';
import { LoadingComponent } from './components/loading/loading.component';
import { SparkleKeyComponent } from './components/sparkle-key/sparkle-key.component';
import { MatchCriteriaModalComponent } from './components/match-criteria-modal/match-criteria-modal.component';

import { MatSnackBarModule } from '@angular/material/snack-bar';
import { ImageUrlPipe } from './pipes/image-url.pipe';
import { BracketHighlightPipe } from './pipes/bracket-highlight.pipe';
import { HasRoleDirective } from './directives/has-role.directive';
import { NavbarComponent } from './components/navbar/navbar.component';
import { FooterComponent } from './components/footer/footer.component';

@NgModule({
  declarations: [
    ConfirmationModalComponent,
    AlertComponent,
    SessionTimeoutModalComponent,
    LogoutButtonComponent,
    NavbarComponent,
    FooterComponent
  ],
  imports: [
    CommonModule,
    RouterModule,
    PasswordStrengthFieldComponent, // Standalone
    PromoCodeInputComponent, // Standalone
    LoadingComponent, // Standalone
    SparkleKeyComponent, // Standalone
    MatchCriteriaModalComponent, // Standalone

    HasRoleDirective, // Standalone
    ImageUrlPipe,
    BracketHighlightPipe,
  ],
  exports: [
    ConfirmationModalComponent,
    AlertComponent,
    SessionTimeoutModalComponent,
    LogoutButtonComponent,
    PasswordStrengthFieldComponent,
    PromoCodeInputComponent,
    LoadingComponent,
    SparkleKeyComponent,
    MatchCriteriaModalComponent,

    HasRoleDirective,
    MatSnackBarModule,
    ImageUrlPipe,
    BracketHighlightPipe,
    NavbarComponent,
    FooterComponent,
    RouterModule
  ],
})
export class SharedModule { }
