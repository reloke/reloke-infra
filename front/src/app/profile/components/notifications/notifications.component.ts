import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { NotificationService, Notification } from '../../../core/services/notification.service';
import { SharedModule } from 'src/app/shared/shared.module';

@Component({
  selector: 'app-notifications',
  standalone: true,
  imports: [CommonModule, RouterModule, SharedModule],
  template: `
    <div class="space-y-6">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-heading font-bold text-main">Toutes les notifications</h1>
          <p class="text-secondary text-sm">Gérez vos alertes et votre historique d'activité</p>
        </div>
        <div class="flex items-center gap-3">
            <button (click)="markAllRead()" *ngIf="notifications.length > 0"
                class="px-4 py-2 text-sm font-semibold text-gray-600 hover:text-primary transition-colors flex items-center gap-2">
                <i class="pi pi-check-circle"></i>
                Tout marquer comme lu
            </button>
            <button (click)="deleteAll()" *ngIf="notifications.length > 0"
                class="px-4 py-2 text-sm font-semibold text-gray-600 hover:text-red-500 transition-colors flex items-center gap-2"
                title="Tout supprimer l'historique">
                <i class="pi pi-trash"></i>
                Tout supprimer
            </button>
        </div>
      </div>

      <div class="bg-bg-card rounded-3xl shadow-card border border-border overflow-hidden">
        <div *ngIf="isLoading && notifications.length === 0" class="p-12 text-center">
            <i class="pi pi-spin pi-spinner text-3xl text-primary mb-4"></i>
            <p class="text-secondary">Chargement de vos notifications...</p>
        </div>

        <div *ngIf="!isLoading && notifications.length === 0" class="p-12 text-center">
            <div class="w-16 h-16 rounded-full bg-gray-50 flex items-center justify-center mx-auto mb-4 text-gray-300">
                <i class="pi pi-bell text-3xl"></i>
            </div>
            <h3 class="text-lg font-bold text-main mb-1">Aucune notification</h3>
            <p class="text-secondary max-w-xs mx-auto">Vous n'avez pas encore reçu de notifications.</p>
        </div>

        <div class="divide-y divide-gray-50">
          <div *ngFor="let n of notifications" 
            class="p-4 sm:p-6 flex gap-4 hover:bg-gray-50/50 transition-colors group"
            [ngClass]="{'bg-primary/5': !n.isRead}">
            
            <div class="h-12 w-12 rounded-2xl flex-shrink-0 flex items-center justify-center shadow-sm"
              [ngClass]="{
                'bg-blue-100 text-blue-600': n.type === 'MESSAGE',
                'bg-green-100 text-green-600': n.type === 'MATCH',
                'bg-gray-100 text-gray-600 border border-gray-200': n.type === 'SYSTEM'
              }">
              <i [class]="getIcon(n.type)" class="text-xl"></i>
            </div>

            <div class="flex-1 min-w-0">
              <div class="flex items-start justify-between gap-4">
                <div class="cursor-pointer" (click)="onNotificationClick(n)">
                  <p class="text-[15px] font-semibold text-gray-900 leading-snug group-hover:text-primary transition-colors">
                    {{ n.content }}
                  </p>
                  <div class="flex items-center gap-3 mt-2">
                    <span class="text-[11px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider" [ngClass]="{
                        'bg-blue-50 text-blue-500': n.type === 'MESSAGE',
                        'bg-green-50 text-green-500': n.type === 'MATCH',
                        'bg-gray-50 text-gray-500': n.type === 'SYSTEM'
                      }">{{ n.type }}</span>
                    <span class="text-xs text-secondary">{{ n.createdAt | date:'fullDate' }} à {{ n.createdAt | date:'shortTime' }}</span>
                  </div>
                </div>

                <div class="flex items-center gap-2">
                  <button *ngIf="!n.isRead" (click)="markAsRead(n.id)" 
                    class="p-2 text-gray-400 hover:text-primary transition-colors" title="Marquer comme lu">
                    <i class="pi pi-check"></i>
                  </button>
                  <button (click)="deleteNotification(n.id)" 
                    class="p-2 text-gray-400 hover:text-red-500 transition-colors" title="Supprimer">
                    <i class="pi pi-trash"></i>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div *ngIf="hasMore" class="p-6 text-center border-t border-gray-50">
            <button (click)="loadMore()" [disabled]="isLoading"
                class="px-6 py-2 bg-gray-50 text-main font-semibold rounded-xl hover:bg-gray-100 transition-all disabled:opacity-50">
                {{ isLoading ? 'Chargement...' : 'Afficher plus' }}
            </button>
        </div>
      </div>
    </div>

    <!-- Modal de confirmation pour la suppression globale -->
    <app-confirmation-modal
      [isOpen]="isDeleteAllModalOpen"
      title="Supprimer tout l'historique"
      message="Voulez-vous vraiment supprimer définitivement toutes vos notifications ? Cette action est irréversible."
      confirmText="Oui, tout supprimer"
      cancelText="Annuler"
      type="danger"
      (confirm)="confirmDeleteAll()"
      (cancel)="isDeleteAllModalOpen = false">
    </app-confirmation-modal>
  `,
  styles: [`
    :host { display: block; }
  `]
})
export class NotificationsComponent implements OnInit {
  notifications: Notification[] = [];
  isLoading = false;
  page = 1;
  hasMore = true;
  isDeleteAllModalOpen = false;

  constructor(
    private notificationService: NotificationService,
    private router: Router
  ) { }

  ngOnInit() {
    this.loadNotifications();
  }

  loadNotifications() {
    if (this.isLoading) return;
    this.isLoading = true;

    this.notificationService.loadNotifications(this.page, 20).subscribe({
      next: (data: Notification[]) => {
        if (this.page === 1) {
          this.notifications = data;
        } else {
          this.notifications = [...this.notifications, ...data];
        }

        if (data.length < 20) {
          this.hasMore = false;
        }

        this.isLoading = false;
      },
      error: () => {
        this.isLoading = false;
      }
    });
  }

  loadMore() {
    this.page++;
    this.loadNotifications();
  }

  getIcon(type: string): string {
    switch (type) {
      case 'MESSAGE': return 'pi pi-comments';
      case 'MATCH': return 'pi pi-heart-fill';
      default: return 'pi pi-info-circle';
    }
  }

  markAsRead(id: number) {
    this.notificationService.markAsRead(id).subscribe(() => {
      const n = this.notifications.find(item => item.id === id);
      if (n) n.isRead = true;
    });
  }

  markAllRead() {
    this.notificationService.markAllAsRead();
    this.notifications.forEach(n => n.isRead = true);
  }

  deleteNotification(id: number) {
    this.notificationService.deleteNotification(id).subscribe(() => {
      this.notifications = this.notifications.filter(n => n.id !== id);
    });
  }

  deleteAll() {
    this.isDeleteAllModalOpen = true;
  }

  confirmDeleteAll() {
    this.notificationService.deleteAll().subscribe(() => {
      this.notifications = [];
      this.hasMore = false;
      this.isDeleteAllModalOpen = false;
    });
  }

  onNotificationClick(notification: any) {
    this.notificationService.markAsRead(notification.id).subscribe(() => {
      if (notification.metadata?.matchGroupId) {
        this.router.navigate(['/matching/chat', notification.metadata.matchGroupId]);
      } else {
        this.router.navigate(['/matching/chat']);
      }
    });
  }
}
