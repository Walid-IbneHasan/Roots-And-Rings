import { z } from 'zod';

export const profileBody = z.object({
  name: z.string().trim().min(1).optional(),
  phone: z.string().trim().min(3).optional(),
});
export const passwordChangeBody = z.object({
  code: z.string().trim().length(6),
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});
