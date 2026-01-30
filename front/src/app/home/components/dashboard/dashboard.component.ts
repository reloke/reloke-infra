import { Router, ActivatedRoute } from '@angular/router';
import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AuthService } from '../../../core/services/auth.service';
import { HomeService } from '../../../profile/services/home.service';
import { SearcherService } from '../../../profile/services/searcher.service';
import { MatchingService, MatchStatusSummary } from '../../../matching/services/matching.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Search } from '../../../profile/models/search.model';
import {
  extractYmd,
  formatLocalYmd,
  getClientTimeZone,
  parseYmdToLocalDate,
  ymdKeyFromDate,
} from '../../../profile/utils/date-utils';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent implements OnInit, OnDestroy {
  userName: string = 'Utilisateur';
  isLogoutModalOpen = false;
  hasExistingHome = false;
  isLoadingHome = true;
  showWelcomeAlert = false;
  hasExistingSearch = false;
  isLoadingSearch = true;
  isSearchStopped = false;
  isPendingDeletion = false;
  deletionDate: Date | null = null;
  showRestoreConfirm = false;
  isRestoring = false;

  // Search period expired modal
  showPeriodExpiredModal = false;
  searchData: Search | null = null;
  newSearchStartDate = '';
  newSearchEndDate = '';
  isUpdatingPeriod = false;
  isStoppingSearch = false;

  // Stop search confirmation modal
  showStopSearchConfirm = false;

  private destroy$ = new Subject<void>();

  constructor(
    private router: Router,
    private authService: AuthService,
    private homeService: HomeService,
    private route: ActivatedRoute,
    private searcherService: SearcherService,
    private matchingService: MatchingService,
    private snackBar: MatSnackBar
  ) {
    const user = this.authService.getCurrentUser();
    if (user) {
      this.userName = user.firstName || 'Utilisateur';
    }
  }

  ngOnInit() {
    this.route.queryParams.subscribe((params) => {
      if (params['welcome'] === 'true') {
        this.showWelcomeAlert = true;
        // Clean URL without reloading
        this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { welcome: null },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
      }

      // Handle stopSearch query param from email link
      if (params['stopSearch'] === '1') {
        this.showStopSearchConfirm = true;
        // Clean URL
        this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { stopSearch: null },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
      }
    });
    this.checkExistingHome();
    this.checkExistingSearch();
    this.checkDeletionStatus();
  }

  private checkDeletionStatus(): void {
    const user = this.authService.getCurrentUser();
    if (user?.deletionScheduledAt) {
      this.isPendingDeletion = true;
      this.deletionDate = new Date(user.deletionScheduledAt);
    } else {
      this.isPendingDeletion = false;
      this.deletionDate = null;
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private checkExistingHome(): void {
    this.isLoadingHome = true;
    this.homeService
      .getMyHome()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (home) => {
          this.hasExistingHome = !!home;
          this.isLoadingHome = false;
        },
        error: () => {
          this.hasExistingHome = false;
          this.isLoadingHome = false;
        },
      });
  }

  private checkExistingSearch(): void {
    this.isLoadingSearch = true;
    this.searcherService.getMySearch()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (search) => {
          this.hasExistingSearch = !!search;
          this.searchData = search;
          this.isLoadingSearch = false;
          this.isSearchStopped = search?.isActivelySearching === false;

          // Check if search period is expired
          if (!this.isSearchStopped && search?.searchEndDate) {
            const endDate = parseYmdToLocalDate(extractYmd(search.searchEndDate));
            const now = new Date();
            if (ymdKeyFromDate(endDate) < ymdKeyFromDate(now)) {
              // Period expired, show modal
              this.showPeriodExpiredModal = true;
              // Set default dates for form
              this.newSearchStartDate = formatLocalYmd(now);
              const defaultEnd = new Date(now);
              defaultEnd.setMonth(defaultEnd.getMonth() + 3);
              this.newSearchEndDate = formatLocalYmd(defaultEnd);
            }
          }
        },
        error: () => {
          this.hasExistingSearch = false;
          this.isLoadingSearch = false;
          this.isSearchStopped = false;
        }
      });
  }

  navigateTo(path: string) {
    this.router.navigate([path]);
  }

  viewMyHome(): void {
    this.router.navigate(['/profile/outgoing'], {
      queryParams: { view: 'true' },
    });
  }

  viewMySearch(): void {
    this.router.navigate(['/profile/searcher'], { queryParams: { view: 'true' } });
  }

  openLogoutModal() {
    this.isLogoutModalOpen = true;
  }

  closeLogoutModal() {
    this.isLogoutModalOpen = false;
  }

  confirmLogout() {
    this.closeLogoutModal();
    this.authService.logout();
  }

  // ============================================================
  // Search Period Modal Methods
  // ============================================================

  closePeriodExpiredModal(): void {
    this.showPeriodExpiredModal = false;
  }

  updateSearchPeriod(): void {
    if (this.isUpdatingPeriod) return;

    // Validate dates
    if (!this.newSearchStartDate || !this.newSearchEndDate) {
      this.snackBar.open('Veuillez remplir les deux dates.', 'Fermer', {
        duration: 3000,
        panelClass: ['custom-snackbar-action-error'],
      });
      return;
    }

    const startDate = parseYmdToLocalDate(extractYmd(this.newSearchStartDate));
    const endDate = parseYmdToLocalDate(extractYmd(this.newSearchEndDate));
    const now = new Date();
    const nowKey = ymdKeyFromDate(now);

    if (ymdKeyFromDate(endDate) < nowKey) {
      this.snackBar.open('La date de fin ne peut pas etre dans le passe.', 'Fermer', {
        duration: 3000,
        panelClass: ['custom-snackbar-action-error'],
      });
      return;
    }

    if (ymdKeyFromDate(endDate) < ymdKeyFromDate(startDate)) {
      this.snackBar.open('La date de fin doit etre apres la date de debut.', 'Fermer', {
        duration: 3000,
        panelClass: ['custom-snackbar-action-error'],
      });
      return;
    }

    this.isUpdatingPeriod = true;
    this.searcherService.updatePeriod(
      this.newSearchStartDate,
      this.newSearchEndDate,
      getClientTimeZone(),
    )
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.isUpdatingPeriod = false;
          this.showPeriodExpiredModal = false;
          this.snackBar.open('Periode de recherche mise a jour !', 'Fermer', {
            duration: 4000,
            panelClass: ['custom-snackbar-action-success'],
          });
          // Refresh search data
          this.checkExistingSearch();
        },
        error: (err) => {
          this.isUpdatingPeriod = false;
          this.snackBar.open(err.message || 'Erreur lors de la mise a jour.', 'Fermer', {
            duration: 4000,
            panelClass: ['custom-snackbar-action-error'],
          });
        },
      });
  }

  openStopSearchFromModal(): void {
    this.showPeriodExpiredModal = false;
    this.showStopSearchConfirm = true;
  }

  closeStopSearchConfirm(): void {
    this.showStopSearchConfirm = false;
  }

  confirmStopSearch(): void {
    if (this.isStoppingSearch) return;

    this.isStoppingSearch = true;
    this.searcherService.stopSearch()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.isStoppingSearch = false;
          this.showStopSearchConfirm = false;
          this.snackBar.open(response.message || 'Recherche arretee.', 'Fermer', {
            duration: 4000,
            panelClass: ['custom-snackbar-action-success'],
          });
          this.checkExistingSearch();
        },
        error: (err) => {
          this.isStoppingSearch = false;
          this.snackBar.open(err.message || 'Erreur lors de l\'arret.', 'Fermer', {
            duration: 4000,
            panelClass: ['custom-snackbar-action-error'],
          });
        },
      });
  }

  restartSearch(): void {
    if (this.isStoppingSearch) return;

    this.isStoppingSearch = true;
    this.searcherService.restartSearch()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.isStoppingSearch = false;
          this.snackBar.open(response.message || 'Recherche relancée.', 'Fermer', {
            duration: 4000,
            panelClass: ['custom-snackbar-action-success'],
          });
          this.checkExistingHome();
          this.checkExistingSearch();
        },
        error: (err) => {
          this.isStoppingSearch = false;
          this.snackBar.open(err.message || 'Erreur lors de la relance.', 'Fermer', {
            duration: 4000,
            panelClass: ['custom-snackbar-action-error'],
          });
        },
      });
  }

  // Deletion/Restore
  openRestoreModal() {
    this.showRestoreConfirm = true;
  }

  closeRestoreModal() {
    this.showRestoreConfirm = false;
  }

  confirmRestore() {
    if (this.isRestoring) return;
    this.isRestoring = true;

    this.authService.cancelDeletion()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response: any) => {
          this.isRestoring = false;
          this.showRestoreConfirm = false;
          this.isPendingDeletion = false;
          this.deletionDate = null;

          // Refresh user state in auth service
          this.authService.getMe().subscribe();

          this.snackBar.open(response.message || 'Compte restauré avec succès.', 'Fermer', {
            duration: 5000,
            panelClass: ['custom-snackbar-action-success'],
          });
        },
        error: (err) => {
          this.isRestoring = false;
          this.snackBar.open('Erreur lors de la restauration. Veuillez réessayer.', 'Fermer', {
            duration: 5000,
            panelClass: ['custom-snackbar-action-error'],
          });
        }
      });
  }

  get searchStoppedAgo(): string {
    const stoppedAt = this.searchData?.searchStoppedAt;
    if (!stoppedAt) return '';
    return this.formatTimeAgo(stoppedAt);
  }

  private formatTimeAgo(dateStr: string): string {
    const then = new Date(dateStr).getTime();
    const now = Date.now();
    const diffMs = Math.max(0, now - then);
    const diffSeconds = Math.floor(diffMs / 1000);

    if (diffSeconds < 60) return 'quelques secondes';

    const diffMinutes = Math.floor(diffSeconds / 60);
    if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes > 1 ? 's' : ''}`;

    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours} heure${diffHours > 1 ? 's' : ''}`;

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) return `${diffDays} jour${diffDays > 1 ? 's' : ''}`;

    const diffMonths = Math.floor(diffDays / 30);
    if (diffMonths < 12) return `${diffMonths} mois`;

    const diffYears = Math.floor(diffMonths / 12);
    return `${diffYears} an${diffYears > 1 ? 's' : ''}`;
  }

  /**
   * Format date for display (French format)
   */
  formatDateDisplay(dateStr: string | null): string {
    if (!dateStr) return '-';
    const date = parseYmdToLocalDate(extractYmd(dateStr));
    return date.toLocaleDateString('fr-FR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }

  /**
   * Get minimum date for input (today)
   */
  get minDate(): string {
    return formatLocalYmd(new Date());
  }
}
