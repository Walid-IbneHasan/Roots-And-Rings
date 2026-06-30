import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { httpError } from '../../lib/errors';
import { requireCustomer } from '../auth/guards';

const addressBody = z.object({
  type: z.enum(['SHIPPING', 'BILLING']).optional(),
  isDefault: z.boolean().optional(),
  name: z.string().trim().min(1),
  phone: z.string().trim().min(1),
  line1: z.string().trim().min(1),
  line2: z.string().trim().optional(),
  city: z.string().trim().min(1),
  district: z.string().trim().min(1),
  postalCode: z.string().trim().optional(),
  country: z.string().trim().optional(),
});

export function registerAddressRoutes(app: FastifyInstance) {
  app.get('/api/account/addresses', { preHandler: requireCustomer }, async (request) => {
    return app.prisma.address.findMany({
      where: { customerId: request.customer!.id },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
  });

  app.post('/api/account/addresses', { preHandler: requireCustomer }, async (request, reply) => {
    const data = addressBody.parse(request.body);
    const customerId = request.customer!.id;
    const created = await app.prisma.$transaction(async (tx) => {
      if (data.isDefault) {
        await tx.address.updateMany({ where: { customerId }, data: { isDefault: false } });
      }
      return tx.address.create({ data: { ...data, customerId } });
    });
    return reply.status(201).send(created);
  });

  app.patch('/api/account/addresses/:id', { preHandler: requireCustomer }, async (request) => {
    const { id } = request.params as { id: string };
    const data = addressBody.partial().parse(request.body);
    const customerId = request.customer!.id;
    const owned = await app.prisma.address.findFirst({ where: { id, customerId } });
    if (!owned) throw httpError(404, 'Address not found');
    return app.prisma.$transaction(async (tx) => {
      if (data.isDefault) {
        await tx.address.updateMany({ where: { customerId }, data: { isDefault: false } });
      }
      return tx.address.update({ where: { id }, data });
    });
  });

  app.post('/api/account/addresses/:id/default', { preHandler: requireCustomer }, async (request) => {
    const { id } = request.params as { id: string };
    const customerId = request.customer!.id;
    const owned = await app.prisma.address.findFirst({ where: { id, customerId } });
    if (!owned) throw httpError(404, 'Address not found');
    await app.prisma.$transaction([
      app.prisma.address.updateMany({ where: { customerId }, data: { isDefault: false } }),
      app.prisma.address.update({ where: { id }, data: { isDefault: true } }),
    ]);
    return { ok: true };
  });

  app.delete('/api/account/addresses/:id', { preHandler: requireCustomer }, async (request) => {
    const { id } = request.params as { id: string };
    const owned = await app.prisma.address.findFirst({ where: { id, customerId: request.customer!.id } });
    if (!owned) throw httpError(404, 'Address not found');
    await app.prisma.address.delete({ where: { id } });
    return { ok: true };
  });
}
