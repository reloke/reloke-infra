import {
  Component,
  OnInit,
  OnDestroy,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  HostListener,
  ElementRef,
  ViewChild,
  AfterViewInit,
} from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import {
  TransactionsApiService,
  TransactionListItem,
  TransactionDetails,
} from '../../services/transactions-api.service';

@Component({
  selector: 'app-transactions',
  templateUrl: './transactions.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TransactionsComponent implements OnInit, OnDestroy, AfterViewInit {
  // Data
  transactions: TransactionListItem[] = [];

  // Desktop table state
  currentPage = 1;
  pageSize = 20;
  total = 0;
  totalPages = 0;

  // Mobile feed state
  nextCursor: string | null = null;
  hasMore = false;

  // Loading states
  isLoading = true;
  isLoadingMore = false;

  // Detail modal state
  selectedTransaction: TransactionDetails | null = null;
  isLoadingDetails = false;
  showDetailModal = false;

  // Responsive
  isMobile = false;

  // Anti-doublon for infinite scroll
  private loadedIds = new Set<number>();

  // Sentinel element for IntersectionObserver
  @ViewChild('sentinel') sentinelRef!: ElementRef<HTMLDivElement>;
  private intersectionObserver: IntersectionObserver | null = null;

  private destroy$ = new Subject<void>();

  constructor(
    private transactionsApi: TransactionsApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.checkMobile();
    this.loadInitial();
  }

  ngAfterViewInit(): void {
    // Setup IntersectionObserver for mobile infinite scroll
    if (this.isMobile) {
      this.setupIntersectionObserver();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.destroyIntersectionObserver();
  }

  @HostListener('window:resize')
  onResize(): void {
    const wasMobile = this.isMobile;
    this.checkMobile();

    // If switched mode, reload data
    if (wasMobile !== this.isMobile) {
      this.resetAndLoad();
    }
  }

  private checkMobile(): void {
    this.isMobile = window.innerWidth < 768;
  }

  private resetAndLoad(): void {
    this.transactions = [];
    this.loadedIds.clear();
    this.currentPage = 1;
    this.nextCursor = null;
    this.hasMore = false;
    this.destroyIntersectionObserver();
    this.loadInitial();

    // Re-setup observer if mobile
    if (this.isMobile) {
      setTimeout(() => this.setupIntersectionObserver(), 0);
    }
  }

  private loadInitial(): void {
    this.isLoading = true;
    this.cdr.markForCheck();

    if (this.isMobile) {
      this.loadFeed();
    } else {
      this.loadTable();
    }
  }

  // ============================================================
  // Desktop Table Methods
  // ============================================================

  private loadTable(): void {
    this.transactionsApi
      .getTransactionsTable(this.currentPage, this.pageSize)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.transactions = response.items;
          this.total = response.total;
          this.totalPages = response.totalPages;
          this.isLoading = false;
          this.cdr.markForCheck();
        },
        error: () => {
          this.isLoading = false;
          this.cdr.markForCheck();
        },
      });
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages || page === this.currentPage) return;
    this.currentPage = page;
    this.isLoading = true;
    this.cdr.markForCheck();
    this.loadTable();
  }

  previousPage(): void {
    this.goToPage(this.currentPage - 1);
  }

  nextPage(): void {
    this.goToPage(this.currentPage + 1);
  }

  // ============================================================
  // Mobile Feed Methods (Infinite Scroll)
  // ============================================================

  private loadFeed(cursor?: string): void {
    this.transactionsApi
      .getTransactionsFeed(this.pageSize, cursor)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          // Anti-doublon: filter out already loaded items
          const newItems = response.items.filter(
            (item) => !this.loadedIds.has(item.id)
          );
          newItems.forEach((item) => this.loadedIds.add(item.id));

          if (cursor) {
            // Append for infinite scroll
            this.transactions = [...this.transactions, ...newItems];
          } else {
            // Initial load
            this.transactions = newItems;
          }

          this.nextCursor = response.nextCursor;
          this.hasMore = response.hasMore;
          this.isLoading = false;
          this.isLoadingMore = false;
          this.cdr.markForCheck();
        },
        error: () => {
          this.isLoading = false;
          this.isLoadingMore = false;
          this.cdr.markForCheck();
        },
      });
  }

  private loadMoreFeed(): void {
    if (this.isLoadingMore || !this.hasMore || !this.nextCursor) return;

    this.isLoadingMore = true;
    this.cdr.markForCheck();
    this.loadFeed(this.nextCursor);
  }

  // ============================================================
  // IntersectionObserver for Infinite Scroll
  // ============================================================

  private setupIntersectionObserver(): void {
    if (!this.sentinelRef?.nativeElement) return;

    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting && !this.isLoadingMore && this.hasMore) {
          this.loadMoreFeed();
        }
      },
      {
        root: null,
        rootMargin: '200px',
        threshold: 0,
      }
    );

    this.intersectionObserver.observe(this.sentinelRef.nativeElement);
  }

  private destroyIntersectionObserver(): void {
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
      this.intersectionObserver = null;
    }
  }

  // ============================================================
  // Helpers
  // ============================================================

  trackById(index: number, item: TransactionListItem): number {
    return item.id;
  }

  formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  formatAmount(amount: number | null, currency: string | null): string {
    if (amount === null) return '-';
    const curr = currency?.toUpperCase() || 'EUR';
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: curr,
    }).format(amount);
  }

  getTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      PAYMENT_CREATED: 'Paiement créé',
      PAYMENT_SUCCEEDED: 'Paiement réussi',
      PAYMENT_FAILED: 'Paiement échoué',
      REFUND_REQUESTED: 'Remboursement demandé',
      REFUND_SUCCEEDED: 'Remboursement effectué',
      REFUND_FAILED: 'Remboursement échoué',
    };
    return labels[type] || type;
  }

  getStatusClass(status: string): string {
    switch (status) {
      case 'SUCCEEDED':
        return 'bg-green-100 text-green-700';
      case 'PENDING':
        return 'bg-yellow-100 text-yellow-700';
      case 'FAILED':
        return 'bg-red-100 text-red-700';
      default:
        return 'bg-gray-100 text-gray-600';
    }
  }

  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      SUCCEEDED: 'Réussi',
      PENDING: 'En attente',
      FAILED: 'Échoué',
    };
    return labels[status] || status;
  }

  getTypeIcon(type: string): string {
    if (type.includes('REFUND')) return 'pi-replay';
    if (type.includes('FAILED')) return 'pi-times-circle';
    if (type.includes('SUCCEEDED')) return 'pi-check-circle';
    return 'pi-credit-card';
  }

  getTypeIconClass(type: string): string {
    if (type.includes('REFUND')) return 'text-orange-500';
    if (type.includes('FAILED')) return 'text-red-500';
    if (type.includes('SUCCEEDED')) return 'text-green-500';
    return 'text-blue-500';
  }

  // ============================================================
  // Detail Modal Methods
  // ============================================================

  /**
   * Open detail modal for a transaction
   */
  openDetails(tx: TransactionListItem): void {
    this.showDetailModal = true;
    this.isLoadingDetails = true;
    this.selectedTransaction = null;
    this.cdr.markForCheck();

    this.transactionsApi
      .getTransactionDetails(tx.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (details) => {
          this.selectedTransaction = details;
          this.isLoadingDetails = false;
          this.cdr.markForCheck();
        },
        error: () => {
          this.isLoadingDetails = false;
          this.cdr.markForCheck();
        },
      });
  }

  /**
   * Close detail modal
   */
  closeDetails(): void {
    this.showDetailModal = false;
    this.selectedTransaction = null;
  }

  /**
   * Get pack name from plan type
   */
  getPlanLabel(planType: string): string {
    const labels: Record<string, string> = {
      STARTER: 'Starter',
      STANDARD: 'Standard',
      PREMIUM: 'Premium',
      ULTIMATE: 'Ultimate',
    };
    return labels[planType] || planType;
  }

  /**
   * Get payment status label
   */
  getPaymentStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      PENDING: 'En attente',
      SUCCEEDED: 'Réussi',
      FAILED: 'Échoué',
      REFUNDED: 'Remboursé',
      PARTIALLY_REFUNDED: 'Partiellement remboursé',
    };
    return labels[status] || status;
  }

  /**
   * Get payment status class
   */
  getPaymentStatusClass(status: string): string {
    switch (status) {
      case 'SUCCEEDED':
        return 'bg-green-100 text-green-700';
      case 'PENDING':
        return 'bg-yellow-100 text-yellow-700';
      case 'FAILED':
        return 'bg-red-100 text-red-700';
      case 'REFUNDED':
        return 'bg-orange-100 text-orange-700';
      case 'PARTIALLY_REFUNDED':
        return 'bg-amber-100 text-amber-700';
      default:
        return 'bg-gray-100 text-gray-600';
    }
  }
}
