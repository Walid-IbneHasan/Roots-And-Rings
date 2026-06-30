import { collectionSchema, type Collection } from '../lib/schema';

const raw = [
  {
    slug: 'the-first-firing',
    name: 'The First Firing',
    tagline: 'A meditation on raw materials.',
    description:
      'This collection embraces the unpredictable nature of wood-firing, resulting in surfaces that map the path of the flame across the clay.',
    image: { src: 'collection-first-firing', alt: 'A wood-fired ceramic bowl on a rough wooden table.' },
  },
  {
    slug: 'quiet-table',
    name: 'The Quiet Table',
    tagline: 'Objects for slow, considered meals.',
    description:
      'Tableware made for the ceremony of small portions — pinched plates, faceted bowls, and pourers that ask you to take your time.',
    image: { src: 'collection-quiet-table', alt: 'A still life of pale plates and a pitcher on linen.' },
  },
  {
    slug: 'porcelain-light',
    name: 'Porcelain & Light',
    tagline: 'Walls thin enough to read the light through.',
    description:
      'A study in translucency — carafes, bud vases, and cups thrown in porcelain and pared back until they glow.',
    image: { src: 'collection-porcelain-light', alt: 'Translucent white porcelain vessels backlit by soft light.' },
  },
];

export const collections: Collection[] = raw.map((c) => collectionSchema.parse(c));
