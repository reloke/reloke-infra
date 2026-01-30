import { Injectable, OnDestroy } from '@angular/core';

import {
  BehaviorSubject,
  EMPTY,
  Observable,
  Subject,
  Subscription,
  timer,
} from 'rxjs';

import {
  catchError,
  distinctUntilChanged,
  exhaustMap,
  filter,
  finalize,
  map,
  shareReplay,
  takeUntil,
  tap,
  withLatestFrom,
} from 'rxjs/operators';

import {
  MatchFilterStatus,
  MatchItem,
  MatchListResponse,
  MatchMarkSeenResponse,
  MatchSortOrder,
  MatchStatusSummary,
  MatchingService,
  GetMatchesParams,
} from './matching.service';

import { NotificationService } from '../../core/notifications/notification.service';

@Injectable({
  providedIn: 'root',
})
export class MatchingStoreService implements OnDestroy {
  private readonly statusSubject =
    new BehaviorSubject<MatchStatusSummary | null>(null);

  private readonly matchesSubject = new BehaviorSubject<MatchItem[]>([]);

  private readonly lastKnownMatchCreatedAtSubject = new BehaviorSubject<
    string | null
  >(null);

  private stopPolling$ = new Subject<void>();

  private pollingSubscription: Subscription | null = null;

  private pollingEnabledSubscription: Subscription | null = null;

  private isFetchingNewMatches = false;

  private isRefreshingStatus = false;

  private lastNotificationSignature: string | null = null;

  private lastPageSize = 10;

  private readonly pollingIntervalMs = 100000; // 100 seconds

  readonly status$ = this.statusSubject.asObservable().pipe(shareReplay(1));

  readonly matches$ = this.matchesSubject.asObservable().pipe(shareReplay(1));

  readonly creditsRemaining$ = this.status$.pipe(
    map((status) => status?.totalMatchesRemaining ?? 0),

    distinctUntilChanged()
  );

  readonly pollingEnabled$ = this.creditsRemaining$.pipe(
    map((remaining) => remaining > 0),

    distinctUntilChanged()
  );

  constructor(
    private readonly matchingService: MatchingService,

    private readonly notificationService: NotificationService
  ) {}

  ngOnDestroy(): void {
    this.stopPolling();
  }

  refreshStatus(): Observable<MatchStatusSummary> {
    if (this.isRefreshingStatus) {
      return EMPTY as Observable<MatchStatusSummary>;
    }

    this.isRefreshingStatus = true;

    return this.matchingService.getMatchStatus().pipe(
      tap((status) => this.statusSubject.next(status)),

      finalize(() => {
        this.isRefreshingStatus = false;
      })
    );
  }

  loadMatches(
    params: GetMatchesParams,
    reset = true
  ): Observable<MatchListResponse> {
    this.lastPageSize = params.pageSize || this.lastPageSize;

    return this.matchingService.getMatches(params).pipe(
      tap((response) => {
        const current = this.matchesSubject.value;

        let nextItems = response.items;

        if (!reset) {
          const next = [...current];

          const indexById = new Map<number, number>();

          for (let i = 0; i < next.length; i += 1) {
            indexById.set(next[i].id, i);
          }

          for (const item of response.items) {
            const existingIndex = indexById.get(item.id);

            if (existingIndex !== undefined) {
              next[existingIndex] = item;
            } else {
              indexById.set(item.id, next.length);

              next.push(item);
            }
          }

          nextItems = next;
        }

        this.matchesSubject.next(nextItems);

        if (response.maxCreatedAt) {
          this.lastKnownMatchCreatedAtSubject.next(response.maxCreatedAt);
        }
      })
    );
  }

  markSeen(): Observable<MatchMarkSeenResponse> {
    return this.matchingService.markMatchesSeen().pipe(
      tap((response) => {
        const status = this.statusSubject.value;

        if (status && response.lastMatchesSeenAt) {
          this.statusSubject.next({
            ...status,

            newMatches: 0,

            lastMatchesSeenAt: response.lastMatchesSeenAt,
          });
        }
      })
    );
  }

  startPolling(): void {
    if (this.pollingSubscription) {
      return;
    }

    this.pollingEnabledSubscription = this.pollingEnabled$.subscribe(
      (enabled) => {
        if (!enabled) {
          this.stopPolling();
        }
      }
    );

    this.pollingSubscription = timer(
      this.pollingIntervalMs,
      this.pollingIntervalMs
    )
      .pipe(
        withLatestFrom(this.pollingEnabled$),

        filter(([_, enabled]) => enabled),

        takeUntil(this.stopPolling$),

        exhaustMap(() => this.refreshStatus().pipe(catchError(() => EMPTY))),

        tap((status) => {
          if (status && status.newMatches > 0) {
            this.handleNewMatches(status);
          }
        })
      )

      .subscribe();
  }

  stopPolling(): void {
    if (this.pollingSubscription) {
      this.pollingSubscription.unsubscribe();

      this.pollingSubscription = null;
    }

    if (this.pollingEnabledSubscription) {
      this.pollingEnabledSubscription.unsubscribe();

      this.pollingEnabledSubscription = null;
    }

    this.stopPolling$.next();

    this.stopPolling$.complete();

    this.stopPolling$ = new Subject<void>();
  }

  private handleNewMatches(status: MatchStatusSummary): void {
    const signature = `${status.lastMatchesSeenAt || 'null'}|${
      status.newMatches
    }`;

    if (signature === this.lastNotificationSignature) {
      return;
    }

    this.lastNotificationSignature = signature;
    this.fetchNewMatches(this.lastPageSize).subscribe({
      next: (response) => {
        if (!response?.items?.length) {
          return;
        }

        const n = status.newMatches ?? 0;
        const isPlural = n > 1;

        this.notificationService.notify({
          title: isPlural ? 'Nouveaux matchs trouvés' : 'Nouveau match trouvé',
          body: isPlural
            ? `Vous avez ${n} nouveaux matchs.`
            : `Vous avez 1 nouveau match.`,
          icon: '/assets/images/logo/reloke-circle-logo-192.png',
          data: { url: `${location.origin}/dashboard` },
        });
      },
    });
  }

  private fetchNewMatches(pageSize: number): Observable<MatchListResponse> {
    if (this.isFetchingNewMatches) {
      return EMPTY as Observable<MatchListResponse>;
    }

    this.isFetchingNewMatches = true;

    const since = this.lastKnownMatchCreatedAtSubject.value || undefined;

    return this.matchingService

      .getMatches({
        since,

        page: 1,

        pageSize,

        status: MatchFilterStatus.ALL,

        sort: MatchSortOrder.NEWEST,
      })

      .pipe(
        tap((response) => {
          const existing = this.matchesSubject.value;

          const existingIds = new Set(existing.map((match) => match.id));

          const newItems = response.items.filter(
            (match) => !existingIds.has(match.id)
          );

          if (newItems.length > 0) {
            this.matchesSubject.next([...newItems, ...existing]);
          }

          if (response.maxCreatedAt) {
            this.lastKnownMatchCreatedAtSubject.next(response.maxCreatedAt);
          }
        }),

        finalize(() => {
          this.isFetchingNewMatches = false;
        }),

        catchError(() => {
          this.isFetchingNewMatches = false;

          return EMPTY as Observable<MatchListResponse>;
        })
      );
  }
}
