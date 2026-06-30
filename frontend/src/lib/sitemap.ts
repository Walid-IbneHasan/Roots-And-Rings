export interface SitemapEntry {
  loc: string;
  lastmod?: string;
}

function xmlEscape(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);
}

export function buildSitemapXml(entries: SitemapEntry[]): string {
  const urls = entries
    .map((e) => {
      const lastmod = e.lastmod ? `\n    <lastmod>${xmlEscape(e.lastmod)}</lastmod>` : '';
      return `  <url>\n    <loc>${xmlEscape(e.loc)}</loc>${lastmod}\n  </url>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
