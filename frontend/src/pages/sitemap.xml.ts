import type { APIRoute } from 'astro';
import { getProducts } from '../lib/catalog';
import { buildSitemapXml, type SitemapEntry } from '../lib/sitemap';
import { site } from '../data/site';

const STATIC_PATHS = ['/', '/objects', '/collections', '/about', '/atelier'];

export const GET: APIRoute = async () => {
  const entries: SitemapEntry[] = STATIC_PATHS.map((p) => ({ loc: new URL(p, site.url).href }));
  try {
    const products = await getProducts();
    for (const p of products) {
      entries.push({
        loc: new URL(`/objects/${p.slug}`, site.url).href,
        lastmod: typeof p.createdAt === 'string' ? p.createdAt.slice(0, 10) : undefined,
      });
    }
  } catch {
    // Catalog unreachable → still serve the static sitemap.
  }
  return new Response(buildSitemapXml(entries), {
    headers: { 'content-type': 'application/xml; charset=utf-8' },
  });
};
