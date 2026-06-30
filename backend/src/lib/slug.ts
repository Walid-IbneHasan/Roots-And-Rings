export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Returns a slug unique under `exists(slug) => boolean`, appending -2, -3, … on collision. */
export async function uniqueSlug(base: string, exists: (slug: string) => Promise<boolean>): Promise<string> {
  const root = slugify(base) || 'item';
  let candidate = root;
  let i = 2;
  while (await exists(candidate)) {
    candidate = `${root}-${i}`;
    i += 1;
  }
  return candidate;
}
