export type RobotsDirective =
  | 'index,follow'
  | 'noindex,follow'
  | 'noindex,nofollow'
  | 'index,nofollow';

export interface SeoConfig {
  title: string;
  description: string;
  canonicalPath: string;
  robots: RobotsDirective;
  ogImage: string;
  ogType: string;
  twitterCard: 'summary' | 'summary_large_image';
  jsonLd?: Record<string, unknown> | Array<Record<string, unknown>>;
}

export type SeoRouteKey = 'home' | 'pricing' | 'faq' | 'contact' | 'login' | 'register';

