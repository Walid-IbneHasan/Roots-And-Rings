import type { FastifyInstance } from 'fastify';
import { renderPage } from '../../lib/render';
import { getUser, requireAdminSession } from './guards';
import { writeAudit } from '../../lib/audit';
import { recomputeProductRating } from '../reviews/service';

export function registerAdminReviews(app: FastifyInstance) {
  const authed = { preHandler: requireAdminSession };
  const authedWrite = { preHandler: [requireAdminSession, app.csrfProtection] };

  app.get('/admin/reviews', authed, async (req, reply) => {
    const user = getUser(req)!;
    const csrf = reply.generateCsrf();
    const { status } = req.query as { status?: string };
    const where = status === 'HIDDEN' || status === 'PUBLISHED' ? { status } : {};
    const reviews = await app.prisma.review.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { product: { select: { name: true, slug: true } } },
    });
    return renderPage(reply, { template: 'reviews-list', title: 'Reviews', user, active: 'reviews', csrf, data: { reviews, status: status ?? '' } });
  });

  async function setStatus(id: string, status: 'PUBLISHED' | 'HIDDEN') {
    const review = await app.prisma.review.update({ where: { id }, data: { status } });
    await recomputeProductRating(app.prisma, review.productId);
    return review;
  }

  app.post('/admin/reviews/:id/hide', authedWrite, async (req, reply) => {
    const user = getUser(req)!;
    const { id } = req.params as { id: string };
    const r = await setStatus(id, 'HIDDEN');
    await writeAudit(app.prisma, { actor: user, action: 'review.hide', entity: 'Review', entityId: id, after: { productId: r.productId }, req });
    return reply.redirect('/admin/reviews');
  });

  app.post('/admin/reviews/:id/unhide', authedWrite, async (req, reply) => {
    const user = getUser(req)!;
    const { id } = req.params as { id: string };
    const r = await setStatus(id, 'PUBLISHED');
    await writeAudit(app.prisma, { actor: user, action: 'review.unhide', entity: 'Review', entityId: id, after: { productId: r.productId }, req });
    return reply.redirect('/admin/reviews');
  });

  app.post('/admin/reviews/:id/delete', authedWrite, async (req, reply) => {
    const user = getUser(req)!;
    const { id } = req.params as { id: string };
    const existing = await app.prisma.review.findUnique({ where: { id } });
    if (!existing) return reply.redirect('/admin/reviews');
    await app.prisma.review.delete({ where: { id } });
    await recomputeProductRating(app.prisma, existing.productId);
    await writeAudit(app.prisma, { actor: user, action: 'review.delete', entity: 'Review', entityId: id, req });
    return reply.redirect('/admin/reviews');
  });
}
