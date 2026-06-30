export const site = {
  name: 'Roots & Rings',
  shortName: 'R&R',
  title: 'Roots & Rings — Collectible Ceramics & Home Objects',
  description:
    'Collectible ceramics and home objects shaped by earth, fire, hand, and time. Small-batch artisan pottery, made in limited editions.',
  tagline: 'Crafted with love, rooted in tradition.',
  url: import.meta.env.PUBLIC_SITE_URL ?? 'https://rootsandrings.net',
  locale: 'en',
  ogImage: '/og-image.jpg',
  social: {
    instagram: 'https://instagram.com',
    pinterest: 'https://pinterest.com',
  },
} as const;
