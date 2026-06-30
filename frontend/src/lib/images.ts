import type { ImageMetadata } from 'astro';

/**
 * Maps an image filename stem (as used in the catalogue data, e.g. "the-kura-vessel-1")
 * to its imported `ImageMetadata`, so `astro:assets` can optimise it at build time.
 *
 * Until real photography is added in Task 18 this map may be empty; callers should
 * fall back to a tonal placeholder when `resolveImage` returns undefined.
 */
const modules = import.meta.glob<{ default: ImageMetadata }>(
  '../assets/images/*.{jpg,jpeg,png,webp,avif}',
  { eager: true },
);

const byStem = new Map<string, ImageMetadata>();
for (const [path, mod] of Object.entries(modules)) {
  const stem = path.split('/').pop()!.replace(/\.[^.]+$/, '');
  byStem.set(stem, mod.default);
}

export function resolveImage(src: string): ImageMetadata | undefined {
  return byStem.get(src);
}

export function hasImage(src: string): boolean {
  return byStem.has(src);
}
