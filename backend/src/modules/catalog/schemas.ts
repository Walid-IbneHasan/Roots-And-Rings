import { z } from 'zod';

export const productsQuery = z.object({
  category: z.string().optional(),
  clayBody: z.string().optional(),
  attribute: z.string().optional(),
  minPrice: z.coerce.number().optional(),
  maxPrice: z.coerce.number().optional(),
  inStock: z.coerce.boolean().optional(),
  onSale: z.coerce.boolean().optional(),
  sort: z.enum(['newest', 'price-asc', 'price-desc', 'name']).default('newest'),
  q: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
});
export type ProductsQuery = z.infer<typeof productsQuery>;

export const categoriesQuery = z.object({
  kind: z.enum(['PRODUCT_TYPE', 'COLLECTION']).optional(),
});
