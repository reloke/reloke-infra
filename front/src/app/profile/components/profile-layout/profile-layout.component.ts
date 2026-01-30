import { Component, AfterViewInit, OnInit, OnDestroy, HostListener, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, NavigationEnd } from '@angular/router';
import { trigger, transition, style, animate, keyframes } from '@angular/animations';
import { Subscription, filter } from 'rxjs';

import { AuthService } from '../../../core/services/auth.service';
import { SharedModule } from '../../../shared/shared.module';
import { NotificationService, Notification } from '../../../core/services/notification.service';
import { FR } from '../../../core/i18n/fr';
import { NotificationPermissionPromptService } from '../../../core/notifications/notification-permission-prompt/notification-permission-prompt.service';
import { NotificationPermissionPromptComponent } from '../../../core/notifications/notification-permission-prompt/notification-permission-prompt.component';

@Component({
  selector: 'app-profile-layout',
  standalone: true,
  imports: [CommonModule, RouterModule, SharedModule, NotificationPermissionPromptComponent],
  templateUrl: './profile-layout.component.html',
  styles: [`
    :host { display: block; }
    .active-notif {
      border-left: 3px solid var(--primary-color, #3b82f6);
    }
    .custom-scrollbar::-webkit-scrollbar {
      width: 4px;
    }
    .custom-scrollbar::-webkit-scrollbar-track {
      background: #f1f1f1;
    }
    .custom-scrollbar::-webkit-scrollbar-thumb {
      background: #ddd;
      border-radius: 10px;
    }
    .custom-scrollbar::-webkit-scrollbar-thumb:hover {
      background: #ccc;
    }
    .truncate-2-lines {
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
  `],
  animations: [
    trigger('shake', [
      transition('* => shake', [
        animate('0.5s', keyframes([
          style({ transform: 'rotate(0)', offset: 0 }),
          style({ transform: 'rotate(15deg)', offset: 0.1 }),
          style({ transform: 'rotate(-15deg)', offset: 0.2 }),
          style({ transform: 'rotate(10deg)', offset: 0.3 }),
          style({ transform: 'rotate(-10deg)', offset: 0.4 }),
          style({ transform: 'rotate(5deg)', offset: 0.5 }),
          style({ transform: 'rotate(-5deg)', offset: 0.6 }),
          style({ transform: 'rotate(0)', offset: 1 }),
        ]))
      ])
    ])
  ]
})
export class ProfileLayoutComponent implements AfterViewInit, OnInit, OnDestroy {
  isSidebarOpen = true;
  isMobile = false;
  isProfileDropdownOpen = false;
  isNotificationDropdownOpen = false;
  common = FR.common;

  notifications: Notification[] = [];
  unreadCount = 0;
  shakeState = 'idle';
  currentTip = '';
  currentSummary = '';

  private readonly SIDEBAR_STORAGE_KEY = 'sidebar_preference';
  private subscriptions = new Subscription();



  navItems: any[] = [];

  constructor(
    private authService: AuthService,
    private notificationService: NotificationService,
    private promptService: NotificationPermissionPromptService,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {
    this.checkScreenSize(true);
    window.addEventListener('resize', () => this.checkScreenSize());
    this.updateNavItems(this.authService.getCurrentUser());
  }

  ngOnInit() {
    this.subscriptions.add(
      this.notificationService.notifications$.subscribe(n => this.notifications = n)
    );
    this.subscriptions.add(
      this.authService.currentUser$.subscribe(user => {
        this.updateNavItems(user);
      })
    );
    this.subscriptions.add(
      this.notificationService.unreadCount$.subscribe(c => this.unreadCount = c)
    );
    this.subscriptions.add(
      this.notificationService.newNotification$.subscribe(() => {
        this.shakeState = 'shake';
        setTimeout(() => this.shakeState = 'idle', 500);
        this.cdr.detectChanges();
      })
    );
    this.subscriptions.add(
      this.promptService.permissionStatus$.subscribe(() => {
        this.cdr.detectChanges();
      })
    );

    // Initial content update
    this.updateDynamicContent(this.router.url);

    // Update on route changes
    this.subscriptions.add(
      this.router.events.pipe(
        filter(event => event instanceof NavigationEnd)
      ).subscribe((event: any) => {
        this.updateDynamicContent(event.url);
      })
    );
  }

  private updateDynamicContent(url: string) {
    if (url.includes('/profile/account')) {
      this.currentTip = 'Un profil vérifié inspire confiance et multiplie par 2 vos chances de match.';
      this.currentSummary = 'Gérez vos informations personnelles et votre vérification d\'identité.';
    } else if (url.includes('/profile/outgoing')) {
      this.currentTip = 'Les annonces avec des photos lumineuses et une description détaillée reçoivent 3x plus de demandes.';
      this.currentSummary = 'Présentez votre logement actuel pour attirer les bons candidats.';
    } else if (url.includes('/profile/searcher')) {
      this.currentTip = 'Élargissez vos critères (dates, zones) pour découvrir plus de correspondances potentielles.';
      this.currentSummary = 'Définissez précisément ce que vous recherchez pour votre prochain logement.';
    } else if (url.includes('/matching/feed')) {
      this.currentTip = 'N\'attendez pas ! Envoyez un premier message dès qu\'un profil vous plaît pour initier l\'échange.';
      this.currentSummary = 'Découvrez les logements qui correspondent à vos critères.';
    } else if (url.includes('/matching/chat')) {
      this.currentTip = 'Soyez réactif et courtois dans vos échanges pour instaurer un climat de confiance réciproque.';
      this.currentSummary = 'Discutez avec vos matchs et organisez vos futurs échanges.';
    } else if (url.includes('/profile/transactions')) {
      this.currentTip = 'Consultez régulièrement vos transactions pour suivre l\'état de vos réservations et services.';
      this.currentSummary = 'Historique de vos paiements et mouvements financiers sur la plateforme.';
    } else {
      this.currentTip = 'Reloke facilite vos échanges de logement. Complétez votre profil pour en profiter au maximum !';
      this.currentSummary = 'Bienvenue sur votre espace personnel Reloke.';
    }
    this.cdr.detectChanges();
  }

  ngOnDestroy() {
    this.subscriptions.unsubscribe();
  }

  ngAfterViewInit() {
    // Removed: checkOnboarding() - driver.js tutorial feature archived
  }

  get currentUser() {
    return this.authService.getCurrentUser();
  }

  get isPendingDeletion(): boolean {
    return !!this.currentUser?.deletionScheduledAt;
  }

  private updateNavItems(user: any) {
    this.navItems = [
      {
        label: 'Tableau de bord',
        link: '/dashboard',
        color: 'text-primary',
        bgColor: 'bg-primary/10',
        svgPath: 'M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z'
      },
      {
        label: 'Mon Logement',
        link: '/profile/outgoing',
        queryParams: { view: true },
        color: 'text-amber-600',
        bgColor: 'bg-amber-50',
        svgPath: 'M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1h3a1 1 0 001-1V10'
      },
      {
        label: 'Ma Recherche',
        link: '/profile/searcher',
        queryParams: { view: true },
        color: 'text-teal-600',
        bgColor: 'bg-teal-50',
        svgPath: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z'
      },
      {
        label: 'Mes Matchs',
        link: '/matching/feed',
        color: 'text-rose-600',
        bgColor: 'bg-rose-50',
        svgPath: 'M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z'
      },
      {
        label: 'Messages',
        link: '/matching/chat',
        color: 'text-purple-600',
        bgColor: 'bg-purple-50',
        svgPath: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z'
      },
      {
        label: 'Mes transactions',
        link: '/profile/transactions',
        color: 'text-emerald-600',
        bgColor: 'bg-emerald-50',
        svgPath: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z'
      }
    ];
  }

  getInitials(): string {
    const user = this.currentUser;
    if (!user) return '?';

    const first = user.firstName?.charAt(0) || '';
    const last = user.lastName?.charAt(0) || '';

    return (first + last).toUpperCase() || user.mail?.charAt(0).toUpperCase() || '?';
  }

  get showPushActivationButton(): boolean {
    return this.promptService.canRequestPermission;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    this.isProfileDropdownOpen = false;
    this.isNotificationDropdownOpen = false;
  }

  toggleProfileDropdown(event: Event) {
    event.stopPropagation();
    this.isProfileDropdownOpen = !this.isProfileDropdownOpen;
    this.isNotificationDropdownOpen = false;
  }

  toggleNotificationDropdown(event: Event) {
    event.stopPropagation();
    this.isNotificationDropdownOpen = !this.isNotificationDropdownOpen;
    this.isProfileDropdownOpen = false;

    if (this.isNotificationDropdownOpen) {
      this.notificationService.loadNotifications(1, 10).subscribe();
    }
  }

  markAllRead(event: Event) {
    event.stopPropagation();
    this.notificationService.markAllAsRead();
  }

  deleteNotification(event: Event, id: number) {
    event.stopPropagation();
    this.notificationService.deleteNotification(id).subscribe();
  }

  deleteAllNotifications(event: Event) {
    event.stopPropagation();
    this.notificationService.deleteAll().subscribe();
  }

  onNotificationClick(notification: any) {
    this.isNotificationDropdownOpen = false;

    // Mark as read before navigating
    this.notificationService.markAsRead(notification.id).subscribe(() => {
      if (notification.metadata?.matchGroupId) {
        this.router.navigate(['/matching/chat', notification.metadata.matchGroupId]);
      } else {
        this.router.navigate(['/matching/chat']);
      }
    });
  }

  requestPushPermission(event?: Event) {
    if (event) event.stopPropagation();
    this.promptService.showPrompt();
  }

  toggleSidebar() {
    this.isSidebarOpen = !this.isSidebarOpen;
    if (!this.isMobile) {
      localStorage.setItem(this.SIDEBAR_STORAGE_KEY, this.isSidebarOpen ? 'expanded' : 'collapsed');
    }
  }

  closeSidebar() {
    if (this.isMobile) {
      this.isSidebarOpen = false;
    }
  }

  isLogoutModalOpen = false;

  openLogoutModal() {
    this.isLogoutModalOpen = true;
    this.isProfileDropdownOpen = false;
  }

  closeLogoutModal() {
    this.isLogoutModalOpen = false;
  }

  confirmLogout() {
    this.closeLogoutModal();
    this.authService.logout();
  }

  private checkScreenSize(isInitial = false) {
    const wasMobile = this.isMobile;
    this.isMobile = window.innerWidth < 1024;

    if (this.isMobile) {
      if (isInitial || !wasMobile) {
        this.isSidebarOpen = false;
      }
    } else {
      const preference = localStorage.getItem(this.SIDEBAR_STORAGE_KEY);
      if (preference) {
        this.isSidebarOpen = preference === 'expanded';
      } else if (isInitial || wasMobile) {
        this.isSidebarOpen = true;
      }
    }
  }
}
