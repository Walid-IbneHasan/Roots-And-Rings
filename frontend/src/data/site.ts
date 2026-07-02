export const site = {
  name: 'Roots & Rings',
  shortName: 'R&R',
  title: 'Roots & Rings — Handcrafted Clay Home Décor',
  description:
    'Handcrafted clay home décor, made with Bangladeshi artisans. Small-batch pottery and decorative pieces for the modern home — an ever-growing collection.',
  tagline: 'Crafted with love, rooted in tradition.',
  url: import.meta.env.PUBLIC_SITE_URL ?? 'https://rootsandrings.net',
  locale: 'en',
  ogImage: '/og-image.jpg',
  social: {
    instagram: 'https://instagram.com',
    pinterest: 'https://pinterest.com',
  },
} as const;
