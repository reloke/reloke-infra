import { Component, OnInit, OnDestroy, ElementRef, ViewChild, AfterViewInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import {
  AdminUserService,
  UserFullContext,
  TransactionWithPayment,
  PaginatedTransactions,
  UserMatchContext,
  PaginatedMatches,
  MatchWithDetails
} from '../../services/admin-user.service';

@Component({
  selector: 'app-admin-user-detail',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './admin-user-detail.component.html',
  styleUrls: ['./admin-user-detail.component.scss']
})
export class AdminUserDetailComponent implements OnInit, OnDestroy, AfterViewInit {
  private destroy$ = new Subject<void>();

  userUid: string | null = null;
  context: UserFullContext | null = null;
  isLoading = true;
  error: string | null = null;

  // Image gallery
  currentImageIndex = 0;
  isGalleryOpen = false;
  galleryImageIndex = 0;

  // Transactions pagination
  transactions: TransactionWithPayment[] = [];
  transactionsLoading = false;
  transactionsPage = 1;
  transactionsLimit = 10;
  transactionsTotalPages = 0;
  transactionsTotal = 0;
  transactionsHasMore = false;
  transactionsCursor?: string;

  // Mobile infinite scroll
  @ViewChild('transactionsSentinel') transactionsSentinel?: ElementRef;
  private transactionsObserver?: IntersectionObserver;
  isMobile = false;

  // Transaction detail modal
  showTransactionModal = false;
  selectedTransaction: TransactionWithPayment | null = null;
  loadingTransactionDetail = false;

  // Matches pagination
  matches: UserMatchContext[] = [];
  matchesLoading = false;
  matchesPage = 1;
  matchesLimit = 10;
  matchesTotalPages = 0;
  matchesTotal = 0;
  matchesHasMore = false;
  matchesCursor?: string;

  // Match detail modal
  showMatchModal = false;
  selectedMatch: MatchWithDetails | null = null;
  loadingMatchDetail = false;

  // Match gallery
  matchGalleryImageIndex = 0;
  isMatchGalleryOpen = false;

  // Home type labels
  private homeTypeLabels: Record<string, string> = {
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
    APARTMENT: 'Appartement',
    HOUSE: 'Maison',
    LOFT: 'Loft',
    DUPLEX: 'Duplex',
    OTHER: 'Autre'
  };

  // Match status labels
  private matchStatusLabels: Record<string, { label: string; class: string }> = {
    NEW: { label: 'Nouveau', class: 'bg-blue-100 text-blue-700' },
    IN_PROGRESS: { label: 'En discussion', class: 'bg-yellow-100 text-yellow-700' },
    CONFIRMED: { label: 'Confirme', class: 'bg-green-100 text-green-700' },
    NOT_INTERESTED: { label: 'Pas interesse', class: 'bg-gray-100 text-gray-600' },
    CANCELLED: { label: 'Annule', class: 'bg-red-100 text-red-700' },
    ARCHIVED: { label: 'Ancien', class: 'bg-gray-200 text-gray-700' }
  };

  // Match type labels
  private matchTypeLabels: Record<string, { label: string; class: string; icon: string }> = {
    STANDARD: { label: 'Echange direct', class: 'bg-blue-100 text-blue-700', icon: 'pi-sync' },
    TRIANGLE: { label: 'Match triangle', class: 'bg-purple-100 text-purple-700', icon: 'pi-share-alt' }
  };

  // Transaction type labels
  private transactionTypeLabels: Record<string, { label: string; icon: string; iconClass: string }> = {
    PAYMENT_CREATED: { label: 'Paiement initie', icon: 'pi-credit-card', iconClass: 'text-blue-500' },
    PAYMENT_SUCCEEDED: { label: 'Paiement reussi', icon: 'pi-check-circle', iconClass: 'text-green-600' },
    PAYMENT_FAILED: { label: 'Paiement echoue', icon: 'pi-times-circle', iconClass: 'text-red-600' },
    REFUND_REQUESTED: { label: 'Remboursement demande', icon: 'pi-replay', iconClass: 'text-orange-500' },
    REFUND_SUCCEEDED: { label: 'Remboursement effectue', icon: 'pi-check', iconClass: 'text-green-600' },
    REFUND_FAILED: { label: 'Remboursement echoue', icon: 'pi-times', iconClass: 'text-red-600' },
    PURCHASE: { label: 'Achat de credits', icon: 'pi-shopping-cart', iconClass: 'text-green-600' },
    REFUND: { label: 'Remboursement', icon: 'pi-replay', iconClass: 'text-orange-500' },
    MATCH_CONSUMED: { label: 'Credit utilise', icon: 'pi-bolt', iconClass: 'text-blue-600' }
  };

  // Transaction status labels
  private transactionStatusLabels: Record<string, { label: string; class: string }> = {
    SUCCEEDED: { label: 'Reussi', class: 'bg-green-100 text-green-700' },
    COMPLETED: { label: 'Complete', class: 'bg-green-100 text-green-700' },
    PENDING: { label: 'En attente', class: 'bg-yellow-100 text-yellow-700' },
    FAILED: { label: 'Echoue', class: 'bg-red-100 text-red-700' },
    REFUNDED: { label: 'Rembourse', class: 'bg-orange-100 text-orange-700' }
  };

  // Payment status labels
  private paymentStatusLabels: Record<string, { label: string; class: string }> = {
    PENDING: { label: 'En attente', class: 'bg-yellow-100 text-yellow-700' },
    SUCCEEDED: { label: 'Reussi', class: 'bg-green-100 text-green-700' },
    FAILED: { label: 'Echoue', class: 'bg-red-100 text-red-700' },
    PARTIALLY_REFUNDED: { label: 'Partiellement rembourse', class: 'bg-orange-100 text-orange-700' },
    REFUNDED: { label: 'Rembourse', class: 'bg-purple-100 text-purple-700' }
  };

  // Plan type labels
  private planTypeLabels: Record<string, string> = {
    PACK_DISCOVERY: 'Pack Decouverte',
    PACK_STANDARD: 'Pack Standard',
    PACK_PRO: 'Pack Pro'
  };

  // Help topic labels
  private helpTopicLabels: Record<string, string> = {
    HOME: 'Mon logement',
    SEARCH: 'Ma recherche',
    SEARCH_CRITERIA: 'Criteres de recherche',
    MATCHES: 'Mes matchs',
    PAYMENTS: 'Paiements',
    OTHER: 'Autre'
  };

  // Help status labels
  private helpStatusLabels: Record<string, { label: string; class: string }> = {
    OPEN: { label: 'En attente', class: 'bg-yellow-100 text-yellow-700' },
    IN_PROGRESS: { label: 'En cours', class: 'bg-blue-100 text-blue-700' },
    RESOLVED: { label: 'Resolu', class: 'bg-green-100 text-green-700' }
  };

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private adminUserService: AdminUserService
  ) {
    this.checkMobile();
  }

  ngOnInit() {
    this.route.params.pipe(takeUntil(this.destroy$)).subscribe(params => {
      const uid = params['userUid'];
      if (uid) {
        this.userUid = uid;
        this.loadUserContext();
      } else {
        this.error = 'UID utilisateur manquant';
        this.isLoading = false;
      }
    });

    // Listen for window resize
    window.addEventListener('resize', () => this.checkMobile());
  }

  ngAfterViewInit() {
    this.setupIntersectionObserver();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.transactionsObserver) {
      this.transactionsObserver.disconnect();
    }
    window.removeEventListener('resize', () => this.checkMobile());
  }

  private checkMobile() {
    this.isMobile = window.innerWidth < 768;
  }

  private setupIntersectionObserver() {
    if (!this.transactionsSentinel?.nativeElement) return;

    this.transactionsObserver = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && this.transactionsHasMore && !this.transactionsLoading && this.isMobile) {
          this.loadMoreTransactions();
        }
      },
      { threshold: 0.1 }
    );

    this.transactionsObserver.observe(this.transactionsSentinel.nativeElement);
  }

  loadUserContext() {
    if (!this.userUid) return;

    this.isLoading = true;
    this.error = null;

    this.adminUserService.getUserContextByUid(this.userUid).pipe(takeUntil(this.destroy$)).subscribe({
      next: (data) => {
        this.context = data;
        this.isLoading = false;
        // Load transactions and matches after context
        this.loadTransactions();
        this.loadMatches();
      },
      error: (err) => {
        console.error('Error loading user context', err);
        this.error = err.error?.message || 'Erreur lors du chargement des donnees utilisateur';
        this.isLoading = false;
      }
    });
  }

  loadTransactions() {
    if (!this.userUid || this.transactionsLoading) return;

    this.transactionsLoading = true;

    if (this.isMobile) {
      // Cursor-based pagination for mobile
      this.adminUserService.getUserTransactionsCursor(this.userUid, undefined, this.transactionsLimit)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (data) => {
            this.transactions = data.items;
            this.transactionsHasMore = data.hasMore;
            this.transactionsCursor = data.nextCursor;
            this.transactionsTotal = data.total || 0;
            this.transactionsLoading = false;
          },
          error: (err) => {
            console.error('Error loading transactions', err);
            this.transactionsLoading = false;
          }
        });
    } else {
      // Page-based pagination for desktop
      this.adminUserService.getUserTransactions(this.userUid, this.transactionsPage, this.transactionsLimit)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (data) => {
            this.transactions = data.items;
            this.transactionsTotalPages = data.totalPages || 0;
            this.transactionsTotal = data.total;
            this.transactionsHasMore = data.hasMore;
            this.transactionsLoading = false;
          },
          error: (err) => {
            console.error('Error loading transactions', err);
            this.transactionsLoading = false;
          }
        });
    }
  }

  loadMoreTransactions() {
    if (!this.userUid || this.transactionsLoading || !this.transactionsHasMore) return;

    this.transactionsLoading = true;

    this.adminUserService.getUserTransactionsCursor(this.userUid, this.transactionsCursor, this.transactionsLimit)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => {
          this.transactions = [...this.transactions, ...data.items];
          this.transactionsHasMore = data.hasMore;
          this.transactionsCursor = data.nextCursor;
          this.transactionsLoading = false;
        },
        error: (err) => {
          console.error('Error loading more transactions', err);
          this.transactionsLoading = false;
        }
      });
  }

  goToTransactionsPage(page: number) {
    if (page < 1 || page > this.transactionsTotalPages || page === this.transactionsPage) return;
    this.transactionsPage = page;
    this.loadTransactions();
  }

  get transactionsPagesArray(): number[] {
    const pages: number[] = [];
    const maxVisible = 5;
    let start = Math.max(1, this.transactionsPage - Math.floor(maxVisible / 2));
    let end = Math.min(this.transactionsTotalPages, start + maxVisible - 1);

    if (end - start + 1 < maxVisible) {
      start = Math.max(1, end - maxVisible + 1);
    }

    for (let i = start; i <= end; i++) {
      pages.push(i);
    }
    return pages;
  }

  // Transaction detail modal
  openTransactionDetail(transaction: TransactionWithPayment) {
    this.selectedTransaction = transaction;
    this.showTransactionModal = true;

    // Load fresh details if payment exists
    if (transaction.id) {
      this.loadingTransactionDetail = true;
      this.adminUserService.getTransactionDetail(transaction.id)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (data) => {
            this.selectedTransaction = data;
            this.loadingTransactionDetail = false;
          },
          error: (err) => {
            console.error('Error loading transaction detail', err);
            this.loadingTransactionDetail = false;
          }
        });
    }
  }

  closeTransactionModal() {
    this.showTransactionModal = false;
    this.selectedTransaction = null;
  }

  // === Matches Pagination ===

  loadMatches() {
    if (!this.userUid || this.matchesLoading) return;

    this.matchesLoading = true;

    if (this.isMobile) {
      // Cursor-based pagination for mobile
      this.adminUserService.getUserMatchesCursor(this.userUid, undefined, this.matchesLimit)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (data) => {
            this.matches = data.items;
            this.matchesHasMore = data.hasMore;
            this.matchesCursor = data.nextCursor;
            this.matchesTotal = data.total || 0;
            this.matchesLoading = false;
          },
          error: (err) => {
            console.error('Error loading matches', err);
            this.matchesLoading = false;
          }
        });
    } else {
      // Page-based pagination for desktop
      this.adminUserService.getUserMatches(this.userUid, this.matchesPage, this.matchesLimit)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (data) => {
            this.matches = data.items;
            this.matchesTotalPages = data.totalPages || 0;
            this.matchesTotal = data.total;
            this.matchesHasMore = data.hasMore;
            this.matchesLoading = false;
          },
          error: (err) => {
            console.error('Error loading matches', err);
            this.matchesLoading = false;
          }
        });
    }
  }

  loadMoreMatches() {
    if (!this.userUid || this.matchesLoading || !this.matchesHasMore) return;

    this.matchesLoading = true;

    this.adminUserService.getUserMatchesCursor(this.userUid, this.matchesCursor, this.matchesLimit)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => {
          this.matches = [...this.matches, ...data.items];
          this.matchesHasMore = data.hasMore;
          this.matchesCursor = data.nextCursor;
          this.matchesLoading = false;
        },
        error: (err) => {
          console.error('Error loading more matches', err);
          this.matchesLoading = false;
        }
      });
  }

  goToMatchesPage(page: number) {
    if (page < 1 || page > this.matchesTotalPages || page === this.matchesPage) return;
    this.matchesPage = page;
    this.loadMatches();
  }

  get matchesPagesArray(): number[] {
    const pages: number[] = [];
    const maxVisible = 5;
    let start = Math.max(1, this.matchesPage - Math.floor(maxVisible / 2));
    let end = Math.min(this.matchesTotalPages, start + maxVisible - 1);

    if (end - start + 1 < maxVisible) {
      start = Math.max(1, end - maxVisible + 1);
    }

    for (let i = start; i <= end; i++) {
      pages.push(i);
    }
    return pages;
  }

  // Match detail modal
  openMatchDetail(match: UserMatchContext) {
    this.showMatchModal = true;
    this.loadingMatchDetail = true;
    this.matchGalleryImageIndex = 0;

    this.adminUserService.getMatchDetail(match.matchUid)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => {
          this.selectedMatch = data;
          this.loadingMatchDetail = false;
        },
        error: (err) => {
          console.error('Error loading match detail', err);
          this.loadingMatchDetail = false;
        }
      });
  }

  closeMatchModal() {
    this.showMatchModal = false;
    this.selectedMatch = null;
    this.isMatchGalleryOpen = false;
  }

  // Match gallery navigation
  previousMatchGalleryImage() {
    if (!this.selectedMatch?.targetHome?.imageUrls) return;
    const len = this.selectedMatch.targetHome.imageUrls.length;
    this.matchGalleryImageIndex = (this.matchGalleryImageIndex - 1 + len) % len;
  }

  nextMatchGalleryImage() {
    if (!this.selectedMatch?.targetHome?.imageUrls) return;
    const len = this.selectedMatch.targetHome.imageUrls.length;
    this.matchGalleryImageIndex = (this.matchGalleryImageIndex + 1) % len;
  }

  goToMatchGalleryImage(index: number) {
    this.matchGalleryImageIndex = index;
  }

  openMatchGallery(index: number) {
    this.matchGalleryImageIndex = index;
    this.isMatchGalleryOpen = true;
  }

  closeMatchGallery() {
    this.isMatchGalleryOpen = false;
  }

  goBack() {
    this.router.navigate(['/admin/dashboard/help']);
  }

  // === Helpers ===

  getHomeTypeLabel(type: string): string {
    return this.homeTypeLabels[type] || type;
  }

  getHomeTypesLabels(types: string[] | null): string {
    if (!types || types.length === 0) return 'Tous types';
    return types.map(t => this.homeTypeLabels[t] || t).join(', ');
  }

  getMatchStatusInfo(status: string) {
    return this.matchStatusLabels[status] || { label: status, class: 'bg-gray-100 text-gray-600' };
  }

  getMatchTypeInfo(type: string) {
    return this.matchTypeLabels[type] || { label: type, class: 'bg-gray-100 text-gray-600', icon: 'pi-heart' };
  }

  getTransactionTypeInfo(type: string) {
    return this.transactionTypeLabels[type] || { label: type, icon: 'pi-credit-card', iconClass: 'text-gray-600' };
  }

  getTransactionStatusInfo(status: string) {
    return this.transactionStatusLabels[status] || { label: status, class: 'bg-gray-100 text-gray-600' };
  }

  getPaymentStatusInfo(status: string) {
    return this.paymentStatusLabels[status] || { label: status, class: 'bg-gray-100 text-gray-600' };
  }

  getPlanTypeLabel(planType: string): string {
    return this.planTypeLabels[planType] || planType;
  }

  getHelpTopicLabel(topic: string): string {
    return this.helpTopicLabels[topic] || topic;
  }

  getHelpStatusInfo(status: string) {
    return this.helpStatusLabels[status] || { label: status, class: 'bg-gray-100 text-gray-600' };
  }

  formatDate(date: Date | string | null): string {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  }

  formatDateTime(date: Date | string | null): string {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  formatAmount(amount: number | null, currency?: string): string {
    if (amount === null || amount === undefined) return '-';
    const value = amount / 100;
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: currency || 'EUR'
    }).format(value);
  }

  formatAmountEuros(amount: number | null, currency?: string): string {
    if (amount === null || amount === undefined) return '-';
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: currency || 'EUR'
    }).format(amount);
  }

  get progressPercent(): number {
    if (!this.context?.credits) return 0;
    const total = this.context.credits.totalMatchesPurchased;
    if (total === 0) return 0;
    return Math.round((this.context.credits.totalMatchesRemaining / total) * 100);
  }

  // Format metadata for display
  formatMetadata(metadata: Record<string, unknown> | null): string {
    if (!metadata) return '-';
    try {
      return JSON.stringify(metadata, null, 2);
    } catch {
      return '-';
    }
  }

  hasStripeError(metadata: Record<string, unknown> | null): boolean {
    if (!metadata) return false;
    return !!(metadata['error'] || metadata['decline_code'] || metadata['failure_code']);
  }

  getStripeError(metadata: Record<string, unknown> | null): string {
    if (!metadata) return '';
    const error = metadata['error'] || metadata['decline_code'] || metadata['failure_code'];
    return error ? String(error) : '';
  }

  // === Image Gallery ===

  previousImage() {
    if (!this.context?.home.home?.imageUrls) return;
    const len = this.context.home.home.imageUrls.length;
    this.currentImageIndex = (this.currentImageIndex - 1 + len) % len;
  }

  nextImage() {
    if (!this.context?.home.home?.imageUrls) return;
    const len = this.context.home.home.imageUrls.length;
    this.currentImageIndex = (this.currentImageIndex + 1) % len;
  }

  goToImage(index: number) {
    this.currentImageIndex = index;
  }

  openGallery(index: number) {
    this.galleryImageIndex = index;
    this.isGalleryOpen = true;
  }

  closeGallery() {
    this.isGalleryOpen = false;
  }

  previousGalleryImage() {
    if (!this.context?.home.home?.imageUrls) return;
    const len = this.context.home.home.imageUrls.length;
    this.galleryImageIndex = (this.galleryImageIndex - 1 + len) % len;
  }

  nextGalleryImage() {
    if (!this.context?.home.home?.imageUrls) return;
    const len = this.context.home.home.imageUrls.length;
    this.galleryImageIndex = (this.galleryImageIndex + 1) % len;
  }

  goToGalleryImage(index: number) {
    this.galleryImageIndex = index;
  }
}
