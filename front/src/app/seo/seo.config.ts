import { SeoConfig, SeoRouteKey } from './seo.model';
import { joinUrl, toAbsoluteUrl } from './seo.utils';

const OG_IMAGE_1200x630 = '/assets/seo/og/reloke-og-1200x630.png';

function baseConfig(publicBaseUrl: string): Omit<SeoConfig, 'title' | 'description' | 'canonicalPath' | 'robots' | 'jsonLd'> {
  return {
    ogImage: toAbsoluteUrl(publicBaseUrl, OG_IMAGE_1200x630),
    ogType: 'website',
    twitterCard: 'summary_large_image',
  };
}

export function getSeoConfig(publicBaseUrl: string, key: SeoRouteKey): SeoConfig {
  const shared = baseConfig(publicBaseUrl);

  switch (key) {
    case 'home': {
      const canonicalPath = '/';
      const canonicalUrl = joinUrl(publicBaseUrl, canonicalPath);
      return {
        ...shared,
        title: 'Reloke \u2014 Acc\u00e9l\u00e9rez votre recherche de logement',
        description:
          'Reloke vous met en relation avec des locataires sortants : identifiez des opportunit\u00e9s avant tout le monde et avancez plus vite, sans passer par une agence.',
        canonicalPath,
        robots: 'index,follow',
        jsonLd: {
          '@context': 'https://schema.org',
          '@graph': [
            {
              '@type': 'Organization',
              '@id': `${publicBaseUrl}/#organization`,
              name: 'Reloke',
              url: publicBaseUrl,
              logo: joinUrl(publicBaseUrl, '/assets/seo/logo-512.png'),
            },
            {
              '@type': 'WebSite',
              '@id': `${publicBaseUrl}/#website`,
              url: publicBaseUrl,
              name: 'Reloke',
              publisher: { '@id': `${publicBaseUrl}/#organization` },
              inLanguage: 'fr-FR',
            },
          ],
        },
      };
    }
    case 'pricing': {
      const canonicalPath = '/tarif';
      return {
        ...shared,
        title: 'Tarifs Reloke \u2014 Packs de matchs pour avancer plus vite',
        description:
          'Choisissez un pack de matchs adapt\u00e9 \u00e0 votre mobilit\u00e9. Payez uniquement ce dont vous avez besoin et acc\u00e9dez au flux de matching d\u00e8s l\u2019activation.',
        canonicalPath,
        robots: 'index,follow',
        jsonLd: {
          '@context': 'https://schema.org',
          '@type': 'Service',
          name: 'Reloke \u2014 Packs de matchs',
          provider: {
            '@type': 'Organization',
            name: 'Reloke',
            url: publicBaseUrl,
          },
          offers: [
            {
              '@type': 'Offer',
              name: 'Pack Discovery (2 matchs)',
              price: '12',
              priceCurrency: 'EUR',
              url: joinUrl(publicBaseUrl, canonicalPath),
            },
            {
              '@type': 'Offer',
              name: 'Pack Standard (5 matchs)',
              price: '25',
              priceCurrency: 'EUR',
              url: joinUrl(publicBaseUrl, canonicalPath),
            },
            {
              '@type': 'Offer',
              name: 'Pack Pro (15 matchs)',
              price: '60',
              priceCurrency: 'EUR',
              url: joinUrl(publicBaseUrl, canonicalPath),
            },
          ],
        },
      };
    }
    case 'faq': {
      const canonicalPath = '/faq';
      return {
        ...shared,
        title: 'FAQ Reloke \u2014 Comment \u00e7a marche, s\u00e9curit\u00e9, dossiers',
        description:
          'D\u00e9couvrez comment fonctionne Reloke, ce qui est v\u00e9rifi\u00e9, comment pr\u00e9parer un dossier solide et ce que vous pouvez attendre du matching.',
        canonicalPath,
        robots: 'index,follow',
        jsonLd: {
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: [
            {
              '@type': 'Question',
              name: 'Reloke, c\u2019est quoi concr\u00e8tement ?',
              acceptedAnswer: {
                '@type': 'Answer',
                text: 'Reloke met en relation des locataires sortants avec des locataires en mobilit\u00e9 qui cherchent dans la m\u00eame zone. Apr\u00e8s un match, vous \u00e9changez directement pour organiser la suite.',
              },
            },
            {
              '@type': 'Question',
              name: 'Reloke garantit-il un logement ?',
              acceptedAnswer: {
                '@type': 'Answer',
                text: 'Non. Reloke acc\u00e9l\u00e8re la mise en relation et augmente vos opportunit\u00e9s, mais la d\u00e9cision finale d\u00e9pend du bailleur/propri\u00e9taire et de votre dossier.',
              },
            },
            {
              '@type': 'Question',
              name: 'Que voit-on avant et apr\u00e8s un match ?',
              acceptedAnswer: {
                '@type': 'Answer',
                text: 'Avant match, aucune information personnelle n\u2019est affich\u00e9e. Apr\u00e8s match, vous acc\u00e9dez aux informations utiles et pouvez discuter via le chat.',
              },
            },
          ],
        },
      };
    }
    case 'contact': {
      const canonicalPath = '/contact';
      return {
        ...shared,
        title: 'Contact Reloke \u2014 Support et questions',
        description: 'Une question sur Reloke, un souci technique ou une demande ? Contactez-nous et obtenez une r\u00e9ponse claire.',
        canonicalPath,
        robots: 'index,follow',
        jsonLd: {
          '@context': 'https://schema.org',
          '@type': 'Organization',
          name: 'Reloke',
          url: publicBaseUrl,
          contactPoint: [
            {
              '@type': 'ContactPoint',
              contactType: 'customer support',
              url: joinUrl(publicBaseUrl, canonicalPath),
              availableLanguage: ['French'],
            },
          ],
        },
      };
    }
    case 'login': {
      return {
        ...shared,
        title: 'Connexion \u2014 Reloke',
        description: 'Acc\u00e9dez \u00e0 votre compte Reloke.',
        canonicalPath: '/auth/login',
        robots: 'noindex,follow',
      };
    }
    case 'register': {
      return {
        ...shared,
        title: 'Inscription \u2014 Reloke',
        description: 'Cr\u00e9ez votre compte Reloke pour acc\u00e9l\u00e9rer votre recherche.',
        canonicalPath: '/auth/register',
        robots: 'noindex,follow',
      };
    }
  }
}

export function getDefaultSeoConfig(publicBaseUrl: string): SeoConfig {
  const shared = baseConfig(publicBaseUrl);
  return {
    ...shared,
    title: 'Reloke',
    description: 'Reloke acc\u00e9l\u00e8re la mise en relation entre locataires sortants et locataires en mobilit\u00e9.',
    canonicalPath: '/',
    robots: 'noindex,follow',
  };
}
