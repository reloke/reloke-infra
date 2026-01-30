import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { AdminService } from '../../../core/services/admin.service';
import { Subject, interval } from 'rxjs';
import { takeUntil, switchMap, filter } from 'rxjs/operators';

interface HelpRequest {
  uid: string;
  topic: string;
  description?: string;
  status: string;
  createdAt: Date;
  user?: { id: number; uid: string; firstName: string; lastName: string; mail: string };
  claimedBy?: { id: number; firstName: string; lastName: string; mail: string } | null;
  claimedAt?: Date | null;
  resolvedAt?: Date | null;
  resolutionNote?: string | null;
  hasAttachments?: boolean;
  attachments?: { id: number; url: string; order: number }[];
}

interface HelpStats {
  open: number;
  inProgress: number;
  resolvedToday: number;
}

@Component({
  selector: 'app-admin-help',
  templateUrl: './admin-help.component.html',
  styleUrls: ['./admin-help.component.scss']
})
export class AdminHelpComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private isTabVisible = true;

  // List state
  requests: HelpRequest[] = [];
  stats: HelpStats = { open: 0, inProgress: 0, resolvedToday: 0 };
  loading = false;
  statusFilter: string = '';
  hasMore = false;
  nextCursor?: string;

  // Detail modal state
  showDetailModal = false;
  selectedRequest: HelpRequest | null = null;
  loadingDetail = false;

  // Resolution modal state
  showResolveModal = false;
  resolutionNote = '';
  resolving = false;

  // Topic labels
  topicLabels: Record<string, string> = {
    HOME: 'Mon logement',
    SEARCH: 'Ma recherche',
    SEARCH_CRITERIA: 'Mes critères',
    MATCHES: 'Mes matchs',
    PAYMENTS: 'Paiements',
    OTHER: 'Autre'
  };

  // Status labels and colors
  statusConfig: Record<string, { label: string; bgClass: string; textClass: string }> = {
    OPEN: { label: 'En attente', bgClass: 'bg-yellow-100', textClass: 'text-yellow-800' },
    IN_PROGRESS: { label: 'En cours', bgClass: 'bg-blue-100', textClass: 'text-blue-800' },
    RESOLVED: { label: 'Résolu', bgClass: 'bg-green-100', textClass: 'text-green-800' }
  };

  constructor(
    private adminService: AdminService,
    private router: Router
  ) {}

  ngOnInit() {
    this.loadRequests();
    this.loadStats();
    this.setupPolling();
    this.setupVisibilityListener();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // === Data Loading ===

  loadRequests(append = false) {
    if (this.loading) return;
    this.loading = true;

    const cursor = append ? this.nextCursor : undefined;

    this.adminService.getHelpRequests(this.statusFilter || undefined, cursor, 20).subscribe({
      next: (data) => {
        if (append) {
          this.requests = [...this.requests, ...data.items];
        } else {
          this.requests = data.items;
        }
        this.hasMore = data.hasMore;
        this.nextCursor = data.nextCursor;
        this.loading = false;
      },
      error: (err) => {
        console.error('Error loading help requests', err);
        this.loading = false;
      }
    });
  }

  loadStats() {
    this.adminService.getHelpStats().subscribe({
      next: (stats) => {
        this.stats = stats;
      },
      error: (err) => {
        console.error('Error loading stats', err);
      }
    });
  }

  loadMore() {
    if (this.hasMore && !this.loading) {
      this.loadRequests(true);
    }
  }

  // === Polling ===

  setupPolling() {
    interval(15000)
      .pipe(
        takeUntil(this.destroy$),
        filter(() => this.isTabVisible && !this.showDetailModal)
      )
      .subscribe(() => {
        this.refreshData();
      });
  }

  setupVisibilityListener() {
    document.addEventListener('visibilitychange', () => {
      this.isTabVisible = document.visibilityState === 'visible';
      if (this.isTabVisible) {
        this.refreshData();
      }
    });
  }

  refreshData() {
    // Silent refresh - don't show loading indicator
    this.adminService.getHelpRequests(this.statusFilter || undefined, undefined, 20).subscribe({
      next: (data) => {
        this.requests = data.items;
        this.hasMore = data.hasMore;
        this.nextCursor = data.nextCursor;
      }
    });
    this.loadStats();
  }

  // === Filter ===

  setFilter(status: string) {
    this.statusFilter = status;
    this.nextCursor = undefined;
    this.loadRequests();
  }

  // === Detail Modal ===

  openDetail(request: HelpRequest) {
    this.selectedRequest = request;
    this.showDetailModal = true;
    this.loadingDetail = true;

    this.adminService.getHelpRequest(request.uid).subscribe({
      next: (data) => {
        this.selectedRequest = data;
        this.loadingDetail = false;
      },
      error: (err) => {
        console.error('Error loading help request detail', err);
        this.loadingDetail = false;
      }
    });
  }

  closeDetail() {
    this.showDetailModal = false;
    this.selectedRequest = null;
  }

  viewUserContext() {
    const userUid = this.selectedRequest?.user?.uid;
    if (!userUid) return;
    this.closeDetail();
    this.router.navigate(['/admin/dashboard/users', userUid]);
  }

  // === Actions ===

  claimRequest() {
    if (!this.selectedRequest) return;

    this.adminService.claimHelpRequest(this.selectedRequest.uid).subscribe({
      next: (updated) => {
        this.selectedRequest = updated;
        this.refreshListItem(updated);
      },
      error: (err) => {
        console.error('Error claiming request', err);
        alert(err.error?.message || 'Erreur lors de la prise en charge');
      }
    });
  }

  releaseRequest() {
    if (!this.selectedRequest) return;

    this.adminService.releaseHelpRequest(this.selectedRequest.uid).subscribe({
      next: (updated) => {
        this.selectedRequest = updated;
        this.refreshListItem(updated);
      },
      error: (err) => {
        console.error('Error releasing request', err);
        alert(err.error?.message || 'Erreur lors de la libération');
      }
    });
  }

  openResolveModal() {
    this.resolutionNote = '';
    this.showResolveModal = true;
  }

  closeResolveModal() {
    this.showResolveModal = false;
    this.resolutionNote = '';
  }

  resolveRequest() {
    if (!this.selectedRequest || this.resolving) return;

    this.resolving = true;
    this.adminService.resolveHelpRequest(this.selectedRequest.uid, this.resolutionNote || undefined).subscribe({
      next: (updated) => {
        this.selectedRequest = updated;
        this.refreshListItem(updated);
        this.closeResolveModal();
        this.resolving = false;
        this.loadStats();
      },
      error: (err) => {
        console.error('Error resolving request', err);
        alert(err.error?.message || 'Erreur lors de la résolution');
        this.resolving = false;
      }
    });
  }

  // === Helpers ===

  refreshListItem(updated: HelpRequest) {
    const index = this.requests.findIndex(r => r.uid === updated.uid);
    if (index !== -1) {
      this.requests[index] = {
        ...this.requests[index],
        status: updated.status,
        claimedBy: updated.claimedBy,
        claimedAt: updated.claimedAt
      };
    }
  }

  getTopicLabel(topic: string): string {
    return this.topicLabels[topic] || topic;
  }

  getStatusConfig(status: string) {
    return this.statusConfig[status] || { label: status, bgClass: 'bg-gray-100', textClass: 'text-gray-800' };
  }

  formatDate(date: Date | string): string {
    return new Date(date).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  formatShortDate(date: Date | string): string {
    return new Date(date).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  getUserName(user?: { firstName: string; lastName: string; mail: string }): string {
    if (!user) return 'Inconnu';
    const name = `${user.firstName} ${user.lastName}`.trim();
    return name || user.mail;
  }
}
