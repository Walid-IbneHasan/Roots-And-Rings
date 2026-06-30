import type { FastifyInstance } from 'fastify';
import { registerAddressRoutes } from './addresses';
import { httpError } from '../../lib/errors';
import { requireCustomer } from '../auth/guards';
import { customerDto } from '../auth/dto';
import { orderToDto } from '../orders/dto';
import { env } from '../../env';
import { hashPassword, verifyPassword } from '../../lib/password';
import { issueOtp, verifyOtp } from '../auth/otp';
import { sendOtpEmail } from '../notifications/email';
import { uploadsService } from '../uploads/service';
import { profileBody, passwordChangeBody } from './schemas';

function summarize(o: { orderNumber: string; status: string; placedAt: Date; grandTotal: unknown; items: { quantity: number }[] }) {
  return {
    orderNumber: o.orderNumber,
    status: o.status,
    placedAt: o.placedAt.toISOString(),
    grand: Number(o.grandTotal),
    itemCount: o.items.reduce((n, i) => n + i.quantity, 0),
  };
}

export default async function accountRoutes(app: FastifyInstance) {
  app.get('/api/account', { preHandler: requireCustomer }, async (request) => {
    const me = request.customer!;
    const recent = await app.prisma.order.findMany({
      where: { customerId: me.id },
      orderBy: { placedAt: 'desc' },
      take: 5,
      include: { items: true },
    });
    return { customer: customerDto(me), recentOrders: recent.map(summarize) };
  });

  app.get('/api/account/orders', { preHandler: requireCustomer }, async (request) => {
    const orders = await app.prisma.order.findMany({
      where: { customerId: request.customer!.id },
      orderBy: { placedAt: 'desc' },
      include: { items: true },
    });
    return orders.map(summarize);
  });

  app.get('/api/account/orders/:orderNumber', { preHandler: requireCustomer }, async (request) => {
    const { orderNumber } = request.params as { orderNumber: string };
    const order = await app.prisma.order.findFirst({
      where: { orderNumber, customerId: request.customer!.id },
      include: { items: true, payments: true, shipment: true },
    });
    if (!order) throw httpError(404, 'Order not found');
    return orderToDto(order);
  });

  app.patch('/api/account/profile', { preHandler: requireCustomer }, async (request) => {
    const data = profileBody.parse(request.body);
    const updated = await app.prisma.customer.update({ where: { id: request.customer!.id }, data });
    return { customer: customerDto(updated) };
  });

  app.post('/api/account/avatar', { preHandler: requireCustomer }, async (request) => {
    const file = await request.file();
    if (!file) throw httpError(400, 'No file uploaded');
    const buf = await file.toBuffer();
    const img = await uploadsService.processImage(buf, 'avatars', 512);
    const updated = await app.prisma.customer.update({
      where: { id: request.customer!.id },
      data: { imageUrl: `${env.APP_URL}${img.url}` },
    });
    return { customer: customerDto(updated) };
  });

  app.post('/api/account/password/request-code', { preHandler: requireCustomer }, async (request) => {
    const code = await issueOtp(app.prisma, request.customer!.id, 'PASSWORD_CHANGE');
    sendOtpEmail(request.customer!.email, 'PASSWORD_CHANGE', code);
    return { ok: true };
  });

  app.post('/api/account/password/change', { preHandler: requireCustomer }, async (request) => {
    const { code, currentPassword, newPassword } = passwordChangeBody.parse(request.body);
    const me = request.customer!;
    if (!me.passwordHash || !(await verifyPassword(currentPassword, me.passwordHash))) {
      throw httpError(400, 'Current password is incorrect');
    }
    await verifyOtp(app.prisma, me.id, 'PASSWORD_CHANGE', code);
    await app.prisma.customer.update({ where: { id: me.id }, data: { passwordHash: await hashPassword(newPassword) } });
    return { ok: true };
  });

  registerAddressRoutes(app);
}
