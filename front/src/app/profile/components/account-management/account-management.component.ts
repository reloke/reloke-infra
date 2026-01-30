import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { RouterModule, Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { SharedModule } from 'src/app/shared/shared.module';

@Component({
  selector: 'app-account-management',
  standalone: true,
  imports: [CommonModule, RouterModule, SharedModule],
  templateUrl: './account-management.component.html',
  styleUrl: './account-management.component.scss',
  styles: [`
    :host { display: block; }
  `]
})
export class AccountManagementComponent implements OnInit {

  isMobileMenuOpen = false;
  currentTabLabel = 'Compte'; // Default

  tabItemsAccountManagement = [
    {
      label: "Compte",
      link: '/profile/account',
      svgPath: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z'
    },
    {
      label: 'Sécurité',
      link: '/profile/security',
      svgPath: 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z'
    },
    {
      label: 'Données',
      link: '/profile/privacy',
      svgPath: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z'
    }
  ];

  constructor(private router: Router) {
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe(() => {
      this.updateCurrentTab();
    });
  }

  ngOnInit() {
    this.updateCurrentTab();
  }

  updateCurrentTab() {
    // Check exact match first or subset
    const found = this.tabItemsAccountManagement.find(item =>
      this.router.url.includes(item.link) || this.router.isActive(item.link, false)
    );
    if (found) {
      this.currentTabLabel = found.label;
    }
  }

  toggleMobileMenu() {
    this.isMobileMenuOpen = !this.isMobileMenuOpen;
  }

  selectTab(label: string) {
    this.currentTabLabel = label;
    this.isMobileMenuOpen = false;
  }

}
