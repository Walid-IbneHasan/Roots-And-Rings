import { getImage } from 'astro:assets';
import { getProducts } from './catalog';
import { resolveImage } from './images';

/**
 * Build a slug → display-info map (with an optimised thumbnail URL) for the client-side
 * cart renderers (drawer + cart page). Embedded as JSON in the page; image URLs are
 * generated at build time by astro:assets.
 */
export interface CartEntry {
  name: string;
  subtitle: string;
  price: number;
  href: string;
  img: string | null;
  alt: string;
}

export async function buildCartLookup(): Promise<Record<string, CartEntry>> {
  const products = await getProducts();
  const lookup: Record<string, CartEntry> = {};
  for (const p of products) {
    const first = p.images[0];
    let img: string | null = null;
    if (first) {
      if (/^https?:\/\//i.test(first.src)) {
        // Remote (backend-served, already optimised WebP)
        img = first.src;
      } else {
        const meta = resolveImage(first.src);
        if (meta) {
          const optimised = await getImage({ src: meta, width: 240, format: 'webp' });
          img = optimised.src;
        }
      }
    }
    lookup[p.slug] = {
      name: p.name,
      subtitle: p.subtitle,
      price: p.price,
      href: `/products/${p.slug}`,
      img,
      alt: first.alt,
    };
  }
  return lookup;
}

/** JSON-encode the lookup safely for embedding in a <script> tag. */
export function lookupToJson(lookup: Record<string, CartEntry>): string {
  return JSON.stringify(lookup).replace(/</g, '\\u003c');
}
