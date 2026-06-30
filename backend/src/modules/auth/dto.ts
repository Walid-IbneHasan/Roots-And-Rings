import type { Customer } from '@prisma/client';

export function customerDto(c: Customer) {
  return {
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone,
    imageUrl: c.imageUrl,
    emailVerifiedAt: c.emailVerifiedAt,
  };
}
