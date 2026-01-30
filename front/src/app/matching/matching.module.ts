import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { MatchingRoutingModule } from './matching-routing.module';
import { MatchFeedComponent } from './components/match-feed/match-feed.component';
import { MatchCardComponent } from './components/match-card/match-card.component';

import { ChatComponent } from './components/chat/chat.component';
import { SearchConfigComponent } from './components/search-config/search-config.component';
import { PaymentComponent } from './components/payment/payment.component';
import { MatchListComponent } from './components/match-list/match-list.component';
import { MatchStatusComponent } from './components/match-status/match-status.component';
import { FormsModule } from '@angular/forms';
import { SharedModule } from '../shared/shared.module';
import { ChatSidebarComponent } from './components/chat/chat-sidebar/chat-sidebar.component';
import { ChatHeaderComponent } from './components/chat/chat-header/chat-header.component';
import { ChatMessagesListComponent } from './components/chat/chat-messages-list/chat-messages-list.component';
import { ChatInputComponent } from './components/chat/chat-input/chat-input.component';
import { NotificationPermissionPromptComponent } from "src/app/core/notifications/notification-permission-prompt/notification-permission-prompt.component";

@NgModule({
  declarations: [
    MatchFeedComponent,
    MatchCardComponent,

    ChatComponent,
    SearchConfigComponent,
    PaymentComponent,
    MatchListComponent,
    MatchStatusComponent,
    ChatSidebarComponent,
    ChatHeaderComponent,
    ChatMessagesListComponent,
    ChatInputComponent
  ],
  imports: [
    CommonModule,
    MatchingRoutingModule,
    FormsModule,
    SharedModule,
    NotificationPermissionPromptComponent
],
  exports: [
    MatchListComponent,
    MatchStatusComponent
  ]
})
export class MatchingModule { }
