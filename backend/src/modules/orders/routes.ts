import type { FastifyInstance } from 'fastify';
import { orderToDto } from './dto';

export default async function ordersRoutes(app: FastifyInstance) {
  app.get('/api/orders/:orderNumber', async (request, reply) => {
    const { orderNumber } = request.params as { orderNumber: string };
    const { token } = request.query as { token?: string };
    const order = await app.prisma.order.findUnique({
      where: { orderNumber },
      include: { items: true, payments: true, shipment: true },
    });
    if (!order || !token || order.orderToken !== token) {
      return reply.status(404).send({ error: 'NotFound', message: 'Order not found', statusCode: 404 });
    }
    return orderToDto(order);
  });
}
