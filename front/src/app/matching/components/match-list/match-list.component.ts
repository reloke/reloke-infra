import { Component, OnInit, OnDestroy, HostListener, Input } from '@angular/core';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import {
  MatchingService,
  MatchItem,
  MatchStatus,
  MatchType,
  MatchFilterStatus,
  MatchSortOrder,
  MatchListResponse,
  MatchStatusSummary,
} from '../../../matching/services/matching.service';
import { MatchingStoreService } from '../../../matching/services/matching-store.service';

@Component({
  selector: 'app-match-list',
  templateUrl: './match-list.component.html',
  styleUrls: ['./match-list.component.scss'],
})
export class MatchListComponent implements OnInit, OnDestroy {
  @Input() mode: 'confirmed' | 'potential' = 'confirmed';
  @Input() showHeader = true;
  // Data
  matches: MatchItem[] = [];
  statusSummary: MatchStatusSummary | null = null;

  // Loading states
  isLoading = true;
  isLoadingMore = false;
  isUpdatingStatus: { [key: number]: boolean } = {};

  // Pagination
  currentPage = 1;
  pageSize = 10;
  totalPages = 0;
  totalItems = 0;
  hasMore = false;

  // Filters & Sorting
  currentFilter: MatchFilterStatus = MatchFilterStatus.ALL;
  currentSort: MatchSortOrder = MatchSortOrder.NEWEST;

  // Mobile infinite scroll
  isMobile = false;

  // Enum references for template
  MatchStatus = MatchStatus;
  MatchType = MatchType;
  MatchFilterStatus = MatchFilterStatus;
  MatchSortOrder = MatchSortOrder;

  private destroy$ = new Subject<void>();
  private hasMarkedSeen = false;
  private isMarkingSeen = false;

  constructor(
    private matchingService: MatchingService,
    private matchingStore: MatchingStoreService,
    private router: Router,
    private snackBar: MatSnackBar
  ) { }

  ngOnInit(): void {
    this.checkMobile();
    this.matchingStore.status$
      .pipe(takeUntil(this.destroy$))
      .subscribe((summary) => {
        this.statusSummary = summary;
      });
    this.matchingStore.matches$
      .pipe(takeUntil(this.destroy$))
      .subscribe((matches) => {
        this.matches = matches;
      });
    this.refreshStatus();
    this.loadMatches();
    this.matchingStore.startPolling();
  }

  ngOnDestroy(): void {
    this.matchingStore.stopPolling(); // <-- à implémenter si pas existant
    this.destroy$.next();
    this.destroy$.complete();
  }

  @HostListener('window:resize')
  onResize(): void {
    this.checkMobile();
  }

  @HostListener('window:scroll')
  onScroll(): void {
    if (this.isMobile && !this.isLoadingMore && this.hasMore) {
      const scrollPosition = window.scrollY + window.innerHeight;
      const documentHeight = document.documentElement.scrollHeight;

      // Load more when near bottom (200px threshold)
      if (scrollPosition >= documentHeight - 200) {
        this.loadMoreMobile();
      }
    }
  }

  private checkMobile(): void {
    this.isMobile = window.innerWidth < 768;
  }

  private refreshStatus(): void {
    this.matchingStore
      .refreshStatus()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        error: () => {
          this.statusSummary = null;
        },
      });
  }

  loadMatches(resetList = true): void {
    if (resetList) {
      this.isLoading = true;
      this.currentPage = 1;
    }

    this.matchingStore
      .loadMatches({
        status: this.currentFilter,
        sort: this.currentSort,
        page: this.currentPage,
        pageSize: this.pageSize,
      }, resetList)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.totalPages = response.pagination.totalPages;
          this.totalItems = response.pagination.totalItems;
          this.hasMore = response.pagination.hasMore;
          this.isLoading = false;
          this.isLoadingMore = false;
          this.logMatchesDebug(response);
          if (resetList) {
            this.markSeenOnce();
          }
        },
        error: () => {
          this.isLoading = false;
          this.isLoadingMore = false;
        },
      });
  }

  private loadMoreMobile(): void {
    if (this.isLoadingMore || !this.hasMore) return;

    this.isLoadingMore = true;
    this.currentPage++;
    this.loadMatches(false);
  }

  private markSeenOnce(): void {
    if (this.hasMarkedSeen || this.isMarkingSeen) {
      return;
    }

    this.isMarkingSeen = true;
    this.matchingStore
      .markSeen()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.hasMarkedSeen = true;
          this.isMarkingSeen = false;
        },
        error: () => {
          this.isMarkingSeen = false;
        },
      });
  }

  // Filter & Sort handlers
  onFilterChange(filter: MatchFilterStatus): void {
    this.currentFilter = filter;
    this.loadMatches(true);
  }

  onSortChange(sort: MatchSortOrder): void {
    this.currentSort = sort;
    this.loadMatches(true);
  }

  // Pagination handlers (desktop)
  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages) return;
    this.currentPage = page;
    this.loadMatches(false);
    // Scroll to top of list
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  previousPage(): void {
    this.goToPage(this.currentPage - 1);
  }

  nextPage(): void {
    this.goToPage(this.currentPage + 1);
  }

  // Status update handlers
  markAsInProgress(match: MatchItem): void {
    if (match.status !== MatchStatus.NEW) return;
    this.updateStatus(match, MatchStatus.IN_PROGRESS);
  }

  markAsNotInterested(match: MatchItem): void {
    if (match.status === MatchStatus.NOT_INTERESTED || match.status === MatchStatus.ARCHIVED) return;
    this.updateStatus(match, MatchStatus.NOT_INTERESTED);
  }

  private updateStatus(match: MatchItem, newStatus: MatchStatus): void {
    this.isUpdatingStatus[match.id] = true;

    this.matchingService
      .updateMatchStatus(match.id, newStatus)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          match.status = response.status;
          match.updatedAt = response.updatedAt;
          this.isUpdatingStatus[match.id] = false;
          this.snackBar.open('Statut mis à jour.', 'Fermer', {
            duration: 3000,
            panelClass: ['custom-snackbar-action-success'],
          });
          this.refreshStatus();
        },
        error: (err) => {
          this.isUpdatingStatus[match.id] = false;
          this.snackBar.open(
            err.message || 'Erreur lors de la mise à jour du statut.',
            'Fermer',
            { duration: 4000, panelClass: ['custom-snackbar-action-error'] }
          );
        },
      });
  }

  // Navigation
  buyMoreMatches(): void {
    this.router.navigate(['/matching/payment']);
  }

  refresh(): void {
    this.refreshStatus();
    this.loadMatches(true);
  }

  // Helper methods
  getStatusLabel(status: MatchStatus): string {
    switch (status) {
      case MatchStatus.NEW:
        return 'Nouveau Match';
      case MatchStatus.IN_PROGRESS:
        return 'Intéressé';
      case MatchStatus.NOT_INTERESTED:
        return 'Pas intéressé';
      case MatchStatus.ARCHIVED:
        return 'Ancien';
      default:
        return status;
    }
  }

  getStatusClass(status: MatchStatus): string {
    switch (status) {
      case MatchStatus.NEW:
        return 'bg-blue-100 text-blue-700';
      case MatchStatus.IN_PROGRESS:
        return 'bg-green-100 text-green-700';
      case MatchStatus.NOT_INTERESTED:
        return 'bg-gray-100 text-gray-500';
      case MatchStatus.ARCHIVED:
        return 'bg-gray-200 text-gray-600';
      default:
        return 'bg-gray-100 text-gray-500';
    }
  }

  getHomeTypeLabel(homeType: string): string {
    const labels: { [key: string]: string } = {
      CHAMBRE: 'Chambre',
      STUDIO: 'Studio',
      T1: 'T1',
      T1_BIS: 'T1 bis',
      T2: 'T2',
      T2_BIS: 'T2 bis',
      T3: 'T3',
      T3_BIS: 'T3 bis',
      T4: 'T4',
      T5: 'T5',
      T6_PLUS: 'T6+',
    };
    return labels[homeType] || homeType;
  }

  formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  get filterLabel(): string {
    switch (this.currentFilter) {
      case MatchFilterStatus.ALL:
        return 'Tous';
      case MatchFilterStatus.NEW:
        return 'Nouveaux';
      case MatchFilterStatus.IN_PROGRESS:
        return 'En discussion';
      case MatchFilterStatus.NOT_INTERESTED:
        return 'Pas intéressés';
      case MatchFilterStatus.ARCHIVED:
        return 'Anciens';
      default:
        return 'Tous';
    }
  }

  get isNotInFlow(): boolean {
    return this.statusSummary !== null && !this.statusSummary.isInFlow;
  }

  get hasNoMatches(): boolean {
    return !this.isLoading && this.matches.length === 0;
  }

  trackByMatch(index: number, match: MatchItem): number {
    return match.id;
  }

  getCoverImage(match: MatchItem): string | undefined {
    return match.targetHome.imageUrls?.[0] || match.targetHome.imageUrl;
  }

  navigateToMatch(match: MatchItem): void {
    if (this.isSwiping) {
      this.isSwiping = false;
      return;
    }
    this.router.navigate(['/matches', match.uid]);
  }

  // Carousel Logic
  activeImageIndices: { [matchId: number]: number } = {};
  private isSwiping = false;
  private touchStartX = 0;

  onCarouselScroll(matchId: number, event: any): void {
    const element = event.target;
    // Calculate active index based on scroll position
    const index = Math.round(element.scrollLeft / element.offsetWidth);
    if (this.activeImageIndices[matchId] !== index) {
      this.activeImageIndices[matchId] = index;
    }
  }

  scrollCarousel(carousel: HTMLElement, direction: number, event: Event): void {
    event.stopPropagation();
    const scrollAmount = carousel.offsetWidth * direction;
    carousel.scrollBy({ left: scrollAmount, behavior: 'smooth' });
  }

  // Touch handling to prevent ghost clicks if needed (mostly handled by native scroll, but safety)
  onCarouselTouchStart(event: TouchEvent): void {
    this.touchStartX = event.touches[0].clientX;
    this.isSwiping = false;
  }

  onCarouselTouchEnd(event: TouchEvent): void {
    const touchEndX = event.changedTouches[0].clientX;
    if (Math.abs(touchEndX - this.touchStartX) > 10) {
      this.isSwiping = true;
      // Reset after short delay to allow subsequent clicks
      setTimeout(() => this.isSwiping = false, 300);
    }
  }

  private logMatchesDebug(response: MatchListResponse): void {
    if (!response?.items) {
      return;
    }

    const firstMatch = response.items[0];
    if (!firstMatch) {
      console.debug('[MatchList] Received matches with no items');
      return;
    }

    const imageUrls = firstMatch.targetHome.imageUrls || [];
    console.debug('[MatchList] First match sample', firstMatch);
    console.debug(
      '[MatchList] Images for first match',
      imageUrls.length,
      'first',
      imageUrls[0] || firstMatch.targetHome.imageUrl
    );
  }
}
