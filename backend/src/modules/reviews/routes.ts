import type { FastifyInstance } from 'fastify';
import { reviewsQuery } from './schemas';

export default async function reviewRoutes(app: FastifyInstance) {
  app.get('/api/products/:slug/reviews', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const { page, pageSize } = reviewsQuery.parse(request.query);
    const product = await app.prisma.product.findUnique({ where: { slug }, select: { id: true, ratingAvg: true, ratingCount: true } });
    if (!product) return reply.status(404).send({ error: 'NotFound', message: 'Product not found', statusCode: 404 });
    const where = { productId: product.id, status: 'PUBLISHED' as const };
    const [items, total] = await Promise.all([
      app.prisma.review.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      app.prisma.review.count({ where }),
    ]);
    return {
      items: items.map((r) => ({ id: r.id, rating: r.rating, title: r.title, body: r.body, authorName: r.authorName, createdAt: r.createdAt.toISOString() })),
      total,
      ratingAvg: product.ratingAvg != null ? Number(product.ratingAvg) : null,
      ratingCount: product.ratingCount,
    };
  });
}
