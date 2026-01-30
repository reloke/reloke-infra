import { Inject, Injectable } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';
import { DOCUMENT } from '@angular/common';
import { filter } from 'rxjs/operators';

import { environment } from '../../environments/environment';
import { getDefaultSeoConfig, getSeoConfig } from './seo.config';
import type { SeoRouteKey } from './seo.model';
import { joinUrl, toAbsoluteUrl } from './seo.utils';

@Injectable({ providedIn: 'root' })
export class SeoService {
  private initialized = false;

  constructor(
    private readonly router: Router,
    private readonly title: Title,
    private readonly meta: Meta,
    @Inject(DOCUMENT) private readonly document: Document,
  ) {}

  init(): void {
    if (this.initialized) return;
    this.initialized = true;

    this.router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd)).subscribe(() => {
      this.applySeo();
    });

    queueMicrotask(() => this.applySeo());
  }

  private applySeo(): void {
    const publicBaseUrl = environment.publicBaseUrl || 'https://reloke.com';
    const seoKey = this.getSeoKeyFromRoute();
    const config = seoKey ? getSeoConfig(publicBaseUrl, seoKey) : getDefaultSeoConfig(publicBaseUrl);

    const canonicalPath = config.canonicalPath || this.getCurrentPathname();
    const canonicalUrl = joinUrl(publicBaseUrl, canonicalPath);
    const ogImage = toAbsoluteUrl(publicBaseUrl, config.ogImage);

    this.title.setTitle(config.title);
    this.setMetaName('description', config.description);
    this.setMetaName('robots', config.robots);

    this.setCanonical(canonicalUrl);

    this.setMetaProperty('og:title', config.title);
    this.setMetaProperty('og:description', config.description);
    this.setMetaProperty('og:url', canonicalUrl);
    this.setMetaProperty('og:image', ogImage);
    this.setMetaProperty('og:type', config.ogType);
    this.setMetaProperty('og:site_name', 'Reloke');

    this.setMetaName('twitter:card', config.twitterCard);
    this.setMetaName('twitter:title', config.title);
    this.setMetaName('twitter:description', config.description);
    this.setMetaName('twitter:image', ogImage);
    this.setMetaName('twitter:url', canonicalUrl);

    this.setJsonLd(config.jsonLd);
  }

  private getSeoKeyFromRoute(): SeoRouteKey | undefined {
    let route = this.router.routerState.snapshot.root;
    while (route.firstChild) {
      route = route.firstChild;
    }
    return route.data?.['seo'] as SeoRouteKey | undefined;
  }

  private getCurrentPathname(): string {
    return this.router.url.split('?')[0].split('#')[0] || '/';
  }

  private setMetaName(name: string, content: string): void {
    this.meta.updateTag({ name, content }, `name='${name}'`);
    this.dedupeHeadElements(`meta[name="${name}"]`);
  }

  private setMetaProperty(property: string, content: string): void {
    this.meta.updateTag({ property, content }, `property='${property}'`);
    this.dedupeHeadElements(`meta[property="${property}"]`);
  }

  private setCanonical(canonicalUrl: string): void {
    const head = this.document.head;
    const existing = Array.from(head.querySelectorAll<HTMLLinkElement>('link[rel="canonical"]'));
    const canonical = existing[0] ?? this.document.createElement('link');

    canonical.setAttribute('rel', 'canonical');
    canonical.setAttribute('href', canonicalUrl);

    if (!existing[0]) {
      head.appendChild(canonical);
    }

    for (const extra of existing.slice(1)) {
      extra.remove();
    }
  }

  private setJsonLd(jsonLd: unknown | undefined): void {
    const head = this.document.head;
    const existing = head.querySelector<HTMLScriptElement>('script#seo-jsonld[type="application/ld+json"]');

    if (!jsonLd) {
      existing?.remove();
      return;
    }

    const script = existing ?? this.document.createElement('script');
    script.id = 'seo-jsonld';
    script.type = 'application/ld+json';
    script.text = JSON.stringify(jsonLd);

    if (!existing) {
      head.appendChild(script);
    }
  }

  private dedupeHeadElements(selector: string): void {
    const elements = Array.from(this.document.head.querySelectorAll(selector));
    for (const extra of elements.slice(1)) {
      extra.remove();
    }
  }
}

