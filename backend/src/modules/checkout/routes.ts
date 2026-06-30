import type { FastifyInstance } from 'fastify';
import { checkoutBody } from './schemas';
import { placeOrder } from './service';
import { customerContext } from '../auth/guards';

export default async function checkoutRoutes(app: FastifyInstance) {
  app.post(
    '/api/checkout',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } }, preHandler: customerContext },
    async (request, reply) => {
      const input = checkoutBody.parse(request.body);
      const result = await placeOrder(app.prisma, input, request.customerClaims?.sub);
      return reply.status(200).send(result);
    },
  );
}
