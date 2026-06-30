import { z } from 'zod';

export const checkoutBody = z.object({
  items: z.array(z.object({ slug: z.string().min(1), qty: z.coerce.number().int().positive() })).min(1),
  contact: z.object({
    name: z.string().trim().min(1),
    email: z.string().email(),
    phone: z.string().trim().min(3),
  }),
  shipping: z.object({
    line1: z.string().trim().min(1),
    line2: z.string().trim().optional(),
    city: z.string().trim().min(1),
    district: z.string().trim().min(1),
    postalCode: z.string().trim().optional(),
    country: z.string().trim().optional(),
  }),
  paymentMethod: z.enum(['COD', 'BKASH']),
  idempotencyKey: z.string().min(8),
});
export type CheckoutInput = z.infer<typeof checkoutBody>;
