import { site } from '../data/site';
import type { Product } from './schema';

const CONTEXT = 'https://schema.org';

/** Absolutize a URL/path against the site origin (leaves already-absolute http(s) URLs intact). */
const abs = (pathOrUrl: string): string =>
  /^https?:\/\//i.test(pathOrUrl) ? pathOrUrl : new URL(pathOrUrl, site.url).href;

export function organizationSchema() {
  return {
    '@type': 'Organization',
    name: site.name,
    url: site.url,
    logo: abs(site.ogImage),
    sameAs: Object.values(site.social),
  };
}

export function websiteSchema() {
  return {
    '@type': 'WebSite',
    name: site.name,
    url: site.url,
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: `${site.url}/objects?q={search_term_string}` },
      'query-input': 'required name=search_term_string',
    },
  };
}

/** Sitewide pair, one script. */
export function siteSchema() {
  return { '@context': CONTEXT, '@graph': [organizationSchema(), websiteSchema()] };
}

export interface ReviewLite {
  authorName: string;
  rating: number;
  title: string | null;
  body: string | null;
}

export function productSchema(product: Product, canonicalUrl: string, reviews: ReviewLite[] = []) {
  const schema: Record<string, unknown> = {
    '@context': CONTEXT,
    '@type': 'Product',
    name: product.name,
    image: product.images.map((i) => abs(i.src)),
    description: product.shortDescription,
    sku: product.slug,
    brand: { '@type': 'Brand', name: site.name },
    offers: {
      '@type': 'Offer',
      price: product.price,
      priceCurrency: product.currency,
      availability: 'https://schema.org/InStock',
      url: canonicalUrl,
    },
  };
  if (product.ratingCount > 0 && product.ratingAvg != null) {
    schema.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: product.ratingAvg,
      reviewCount: product.ratingCount,
    };
  }
  if (reviews.length) {
    schema.review = reviews.slice(0, 5).map((r) => ({
      '@type': 'Review',
      author: { '@type': 'Person', name: r.authorName },
      reviewRating: { '@type': 'Rating', ratingValue: r.rating },
      ...(r.title ? { name: r.title } : {}),
      ...(r.body ? { reviewBody: r.body } : {}),
    }));
  }
  return schema;
}

export function breadcrumbSchema(items: { name: string; url: string }[]) {
  return {
    '@context': CONTEXT,
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      name: it.name,
      item: abs(it.url),
    })),
  };
}

export function itemListSchema(items: { name: string; url: string }[]) {
  return {
    '@context': CONTEXT,
    '@type': 'ItemList',
    itemListElement: items.map((it, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      name: it.name,
      url: abs(it.url),
    })),
  };
}
