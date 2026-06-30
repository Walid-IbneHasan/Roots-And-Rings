import { describe, it, expect } from 'vitest';
import { buildSitemapXml } from '../src/lib/sitemap';

describe('buildSitemapXml', () => {
  it('renders a valid urlset with loc + optional lastmod', () => {
    const xml = buildSitemapXml([
      { loc: 'https://rootsandrings.net/' },
      { loc: 'https://rootsandrings.net/objects/kura-vessel', lastmod: '2026-06-01' },
    ]);
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<urlset');
    expect(xml).toContain('<loc>https://rootsandrings.net/objects/kura-vessel</loc>');
    expect(xml).toContain('<lastmod>2026-06-01</lastmod>');
    expect(xml.match(/<url>/g)?.length).toBe(2);
  });

  it('xml-escapes special characters in loc', () => {
    const xml = buildSitemapXml([{ loc: 'https://rootsandrings.net/objects?q=a&b' }]);
    expect(xml).toContain('q=a&amp;b');
    expect(xml).not.toContain('q=a&b<');
  });
});
