import { PrismaClient } from '@prisma/client';
import { pathToFileURL } from 'node:url';
import { env } from '../env';
import { hashPassword } from '../lib/password';

/** Idempotently ensure an ADMIN user exists from env credentials. */
export async function ensureAdmin(prisma: PrismaClient) {
  const passwordHash = await hashPassword(env.ADMIN_PASSWORD);
  return prisma.user.upsert({
    where: { email: env.ADMIN_EMAIL },
    update: { role: 'ADMIN', isActive: true, passwordHash },
    create: {
      email: env.ADMIN_EMAIL,
      name: 'Administrator',
      role: 'ADMIN',
      isActive: true,
      passwordHash,
    },
  });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const prisma = new PrismaClient();
  ensureAdmin(prisma)
    .then((u) => {
      console.log(`✔ Admin ready: ${u.email}`);
    })
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
