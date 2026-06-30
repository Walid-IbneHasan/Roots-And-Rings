import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { httpError } from '../../lib/errors';
import { requireCustomer } from '../auth/guards';

const addBody = z.object({ slug: z.string().trim().min(1) });
const mergeBody = z.object({ slugs: z.array(z.string().trim().min(1)).max(200) });

async function listSlugs(app: FastifyInstance, customerId: string): Promise<string[]> {
  const rows = await app.prisma.wishlistItem.findMany({
    where: { customerId },
    orderBy: { createdAt: 'desc' },
    include: { product: { select: { slug: true } } },
  });
  return rows.map((r) => r.product.slug);
}

export function registerWishlistRoutes(app: FastifyInstance) {
  app.get('/api/account/wishlist', { preHandler: requireCustomer }, async (request) => {
    return listSlugs(app, request.customer!.id);
  });

  app.post('/api/account/wishlist', { preHandler: requireCustomer }, async (request, reply) => {
    const { slug } = addBody.parse(request.body);
    const customerId = request.customer!.id;
    const product = await app.prisma.product.findFirst({ where: { slug, isActive: true }, select: { id: true } });
    if (!product) throw httpError(404, 'Product not found');
    await app.prisma.wishlistItem.upsert({
      where: { customerId_productId: { customerId, productId: product.id } },
      create: { customerId, productId: product.id },
      update: {},
    });
    return reply.status(201).send({ ok: true });
  });

  app.delete('/api/account/wishlist/:slug', { preHandler: requireCustomer }, async (request) => {
    const { slug } = request.params as { slug: string };
    const customerId = request.customer!.id;
    const product = await app.prisma.product.findFirst({ where: { slug }, select: { id: true } });
    if (product) {
      await app.prisma.wishlistItem.deleteMany({ where: { customerId, productId: product.id } });
    }
    return { ok: true };
  });

  app.post('/api/account/wishlist/merge', { preHandler: requireCustomer }, async (request) => {
    const { slugs } = mergeBody.parse(request.body);
    const customerId = request.customer!.id;
    if (slugs.length) {
      const products = await app.prisma.product.findMany({
        where: { slug: { in: slugs }, isActive: true },
        select: { id: true },
      });
      for (const p of products) {
        await app.prisma.wishlistItem.upsert({
          where: { customerId_productId: { customerId, productId: p.id } },
          create: { customerId, productId: p.id },
          update: {},
        });
      }
    }
    return listSlugs(app, customerId);
  });
}
