import { z } from 'zod';

export const validateBody = z.object({
  code: z.string().trim().min(1),
  items: z.array(z.object({ slug: z.string().min(1), qty: z.coerce.number().int().positive() })).min(1),
});
export type ValidateInput = z.infer<typeof validateBody>;
