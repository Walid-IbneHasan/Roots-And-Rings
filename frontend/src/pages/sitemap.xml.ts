import type { APIRoute } from 'astro';
import { getProducts, getCollections } from '../lib/catalog';
import { buildSitemapXml, type SitemapEntry } from '../lib/sitemap';
import { site } from '../data/site';

const STATIC_PATHS = ['/', '/products', '/collections', '/about', '/atelier'];

export const GET: APIRoute = async () => {
  const entries: SitemapEntry[] = STATIC_PATHS.map((p) => ({ loc: new URL(p, site.url).href }));
  try {
    const products = await getProducts();
    for (const p of products) {
      entries.push({
        loc: new URL(`/products/${p.slug}`, site.url).href,
        lastmod: typeof p.createdAt === 'string' ? p.createdAt.slice(0, 10) : undefined,
      });
    }
  } catch {
    // Catalog unreachable → still serve the static sitemap.
  }
  try {
    const collections = await getCollections();
    for (const c of collections) {
      entries.push({ loc: new URL(`/collections/${c.slug}`, site.url).href });
    }
  } catch {
    // Collections unreachable → skip; rest of the sitemap still serves.
  }
  return new Response(buildSitemapXml(entries), {
    headers: { 'content-type': 'application/xml; charset=utf-8' },
  });
};
