import { z } from 'zod';

/** Image reference: `src` is a filename stem resolved against src/assets/images. */
export const imageRefSchema = z.object({
  src: z.string().min(1),
  alt: z.string().min(1),
});
export type ImageRef = z.infer<typeof imageRefSchema>;

export const CATEGORIES = ['Vessels', 'Bowls', 'Plates', 'Sculptural', 'Tableware'] as const;
export const BODY_TYPES = ['Stoneware', 'Porcelain', 'Earthenware'] as const;
export const BADGES = ['Limited Edition', 'Made to Order'] as const;

export type Category = (typeof CATEGORIES)[number];
export type BodyType = (typeof BODY_TYPES)[number];
export type Badge = (typeof BADGES)[number];

export const specsSchema = z.object({
  dimensions: z.string().min(1),
  weight: z.string().min(1),
  bodyType: z.string().min(1),
});
export type Specs = z.infer<typeof specsSchema>;

export const editionSchema = z.object({
  /** Archive reference, e.g. "AR-04". */
  ref: z.string().min(1),
  /** Total pieces in the edition. */
  count: z.number().int().positive(),
  /** Whether a certificate of authenticity is included. */
  certificate: z.boolean(),
  /** Optional made-to-order lead time copy. */
  leadTime: z.string().optional(),
});
export type Edition = z.infer<typeof editionSchema>;

export const seenInInteriorsSchema = z.object({
  text: z.string().min(1),
  image: imageRefSchema,
});

export const productSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  subtitle: z.string().default(''),
  price: z.number().nonnegative(),
  compareAt: z.number().nullable().default(null),
  isOnSale: z.boolean().default(false),
  isOnFlash: z.boolean().default(false),
  currency: z.string().default('BDT'),
  category: z.string().default(''),
  bodyType: z.string().default(''),
  badges: z.array(z.string()).default([]),
  shortDescription: z.string().min(1),
  description: z.string().min(1),
  curatorsNote: z.string().min(1),
  specs: specsSchema,
  edition: editionSchema.optional(),
  images: z.array(imageRefSchema).min(1),
  relatedSlugs: z.array(z.string()).default([]),
  seenInInteriors: seenInInteriorsSchema.optional(),
  featured: z.boolean().optional(),
  createdAt: z.string().min(1),
  ratingAvg: z.number().nullable().default(null),
  ratingCount: z.number().default(0),
  availability: z.enum(['in_stock', 'out_of_stock', 'backorder']).default('in_stock'),
});
export type Product = z.infer<typeof productSchema>;

export const collectionSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  tagline: z.string().min(1),
  description: z.string().min(1),
  image: imageRefSchema,
});
export type Collection = z.infer<typeof collectionSchema>;
