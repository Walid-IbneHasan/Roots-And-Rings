import { z } from 'zod';

export const registerBody = z.object({
  name: z.string().trim().min(1),
  email: z.string().email(),
  password: z.string().min(8),
});
export const loginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export const verifyEmailBody = z.object({ code: z.string().trim().length(6) });
export const forgotBody = z.object({ email: z.string().email() });
export const resetBody = z.object({
  email: z.string().email(),
  code: z.string().trim().length(6),
  newPassword: z.string().min(8),
});
