export interface NavLink {
  label: string;
  href: string;
}

/** Primary navigation, left of the wordmark on desktop. */
export const mainNav: NavLink[] = [
  { label: 'Shop', href: '/products' },
  { label: 'Collections', href: '/collections' },
  { label: 'Atelier', href: '/atelier' },
  { label: 'About', href: '/about' },
];

/** Footer link columns. */
export const footerNav: { heading: string; links: NavLink[] }[] = [
  {
    heading: 'Explore',
    links: [
      { label: 'Shop', href: '/products' },
      { label: 'Collections', href: '/collections' },
      { label: 'Atelier', href: '/atelier' },
    ],
  },
  {
    heading: 'Support',
    links: [
      { label: 'Care Guide', href: '/about' },
      { label: 'Shipping & Returns', href: '/about' },
      { label: 'Contact', href: '/about' },
    ],
  },
];

/** Compact link row used in the minimal home/global footer. */
export const minimalFooterNav: NavLink[] = [
  { label: 'Shop', href: '/products' },
  { label: 'Collections', href: '/collections' },
  { label: 'Atelier', href: '/atelier' },
  { label: 'Contact', href: '/about' },
];
