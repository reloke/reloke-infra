import { isPlatformBrowser } from '@angular/common';
import { Component, HostListener, Inject, PLATFORM_ID } from '@angular/core';

@Component({
    selector: 'app-navbar',
    templateUrl: './navbar.component.html',
    styleUrls: ['./navbar.component.scss']
})
export class NavbarComponent {
    isMenuOpen = false;
    scrolled = false;
    private readonly isBrowser: boolean;

    constructor(@Inject(PLATFORM_ID) platformId: object) {
        this.isBrowser = isPlatformBrowser(platformId);
    }

    @HostListener('window:scroll', [])
    onWindowScroll() {
        if (!this.isBrowser) return;
        this.checkScroll();
    }

    checkScroll() {
        if (!this.isBrowser) return;
        this.scrolled = window.scrollY > 20;
    }

    toggleMenu() {
        this.isMenuOpen = !this.isMenuOpen;
    }

    closeMenu() {
        this.isMenuOpen = false;
    }
}
