import { Injectable } from '@angular/core';
import { forkJoin, map, Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { AuthService } from '../../../core/services/auth.service';
import { ChatService, Conversation } from '../../../core/services/chat.service';
import { HomeService } from '../../../profile/services/home.service';
import { SearcherService } from '../../../profile/services/searcher.service';
import {
  MatchingService,
  MatchingSummary,
  MatchStatusSummary,
} from '../../../matching/services/matching.service';
import { OnboardingDataSnapshot } from './onboarding-timeline.model';

@Injectable({ providedIn: 'root' })
export class OnboardingSummaryService {
  constructor(
    private authService: AuthService,
    private homeService: HomeService,
    private searcherService: SearcherService,
    private matchingService: MatchingService,
    private chatService: ChatService
  ) {}

  getSnapshot(): Observable<OnboardingDataSnapshot> {
    const defaultMatchingSummary: MatchingSummary = {
      totalMatchesPurchased: 0,
      totalMatchesUsed: 0,
      totalMatchesRemaining: 0,
      payments: [],
      refundEligible: false,
      refundAmount: 0,

      refundCooldownUntil: null,
      refundCooldownRemainingMs: null,
      canBuyNewPack: true,

      matchingProcessingUntil: null,
      isRefundBlockedByMatching: false,
      blockingReason: null,
    };

    const defaultMatchStatus: MatchStatusSummary = {
      isInFlow: false,
      totalMatchesPurchased: 0,
      totalMatchesUsed: 0,
      totalMatchesRemaining: 0,
      totalMatches: 0,
      newMatches: 0,
      inProgressMatches: 0,
      lastMatchesSeenAt: null,
      serverNow: new Date().toISOString(),
    };

    return forkJoin({
      home: this.homeService.getMyHome().pipe(catchError(() => of(null))),
      search: this.searcherService.getMySearch().pipe(catchError(() => of(null))),
      matchingSummary: this.matchingService
        .getMatchingSummary()
        .pipe(catchError(() => of(defaultMatchingSummary))),
      matchStatus: this.matchingService.getMatchStatus().pipe(catchError(() => of(defaultMatchStatus))),
      conversations: this.chatService.getConversations().pipe(catchError(() => of([] as Conversation[]))),
    }).pipe(
      map(({ home, search, matchingSummary, matchStatus, conversations }) => {
        const user = this.authService.getCurrentUser();
        const activeChatsCount = Array.isArray(conversations)
          ? conversations.filter((c) => c.status === 'ACTIVE').length
          : 0;

        const hasPurchasedBefore =
          (matchingSummary.totalMatchesPurchased ?? 0) > 0 ||
          (Array.isArray(matchingSummary.payments) && matchingSummary.payments.length > 0);

          console.log("hhhhhh");
        return {
          userKycStatus: user?.kycStatus,
          home,
          search,
          creditsRemaining: matchStatus.totalMatchesRemaining ?? matchingSummary.totalMatchesRemaining ?? 0,
          hasPurchasedBefore,
          isInFlow: matchStatus.isInFlow ?? false,
          matchesCount: matchStatus.totalMatches ?? 0,
          activeChatsCount,
        };
      })
    );
  }
}

