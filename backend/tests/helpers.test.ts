import { describe, it, expect } from 'vitest';
import { slugify, uniqueSlug } from '../src/lib/slug';
import { sanitizeRichText } from '../src/lib/sanitize';
import { hashPassword, verifyPassword } from '../src/lib/password';

describe('slugify', () => {
  it('kebab-cases and strips punctuation', () => {
    expect(slugify('The Kura Vessel')).toBe('the-kura-vessel');
    expect(slugify('Roots & Rings')).toBe('roots-and-rings');
    expect(slugify("Curator’s Note!")).toBe('curators-note');
  });
});

describe('uniqueSlug', () => {
  it('appends -2 on collision', async () => {
    const taken = new Set(['vase']);
    const s = await uniqueSlug('Vase', async (x) => taken.has(x));
    expect(s).toBe('vase-2');
  });
  it('returns base when free', async () => {
    expect(await uniqueSlug('Bowl', async () => false)).toBe('bowl');
  });
});

describe('sanitizeRichText', () => {
  it('strips scripts but keeps allowed tags', () => {
    const out = sanitizeRichText('<p>Hello <strong>world</strong></p><script>alert(1)</script>');
    expect(out).toContain('<strong>world</strong>');
    expect(out).not.toContain('<script>');
  });
  it('rewrites links with rel/target', () => {
    const out = sanitizeRichText('<a href="https://x.com">x</a>');
    expect(out).toContain('rel="noopener nofollow"');
  });
});

describe('password', () => {
  it('hashes and verifies', async () => {
    const hash = await hashPassword('secret123');
    expect(hash).not.toBe('secret123');
    expect(await verifyPassword('secret123', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });
});
