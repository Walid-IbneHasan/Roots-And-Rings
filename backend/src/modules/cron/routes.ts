import type { FastifyInstance } from 'fastify';
import { env } from '../../env';
import { releaseReservations } from '../inventory/service';

const rc = { isolationLevel: 'ReadCommitted' as const };

export default async function cronRoutes(app: FastifyInstance) {
  // Token-guarded (cPanel-friendly). The always-on worker loop is Phase 3; the logic lives here.
  app.post('/cron/expire-orders', { config: { rateLimit: false } }, async (request, reply) => {
    if (request.headers['x-cron-token'] !== env.CRON_TOKEN) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'Bad cron token', statusCode: 401 });
    }
    const now = new Date();
    const stale = await app.prisma.inventoryReservation.findMany({ where: { status: 'ACTIVE', expiresAt: { lt: now } } });
    const orderIds = [...new Set(stale.map((r) => r.orderId))];

    let releasedReservations = 0;
    let expiredOrders = 0;
    for (const orderId of orderIds) {
      await app.prisma.$transaction((tx) => releaseReservations(tx, orderId), rc);
      releasedReservations += stale.filter((r) => r.orderId === orderId).length;
      const upd = await app.prisma.order.updateMany({ where: { id: orderId, status: 'AWAITING_PAYMENT' }, data: { status: 'EXPIRED' } });
      expiredOrders += upd.count;
    }
    return { releasedReservations, expiredOrders };
  });
}
