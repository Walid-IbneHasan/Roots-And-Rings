import type { FastifyInstance } from 'fastify';
import { renderPage } from '../../lib/render';
import { getUser, requireAdminSession } from './guards';

export function registerAdminDashboard(app: FastifyInstance) {
  app.get('/admin', { preHandler: requireAdminSession }, async (req, reply) => {
    const user = getUser(req)!;
    const csrf = reply.generateCsrf();
    const [products, categories, users, lowStock, recent] = await Promise.all([
      app.prisma.product.count(),
      app.prisma.category.count(),
      app.prisma.user.count(),
      app.prisma.productVariant.count({ where: { stock: { lte: 0 }, isActive: true } }),
      app.prisma.adminAuditLog.findMany({ take: 8, orderBy: { createdAt: 'desc' } }),
    ]);
    return renderPage(reply, {
      template: 'dashboard',
      title: 'Dashboard',
      user,
      active: 'dashboard',
      csrf,
      data: { counts: { products, categories, users, lowStock }, recent },
    });
  });
}
