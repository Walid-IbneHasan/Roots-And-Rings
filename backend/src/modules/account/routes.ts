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
import { upsertReview, canReview } from '../reviews/service';
import { reviewBody } from '../reviews/schemas';

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
    const dto = orderToDto(order);
    const ids = [...new Set(order.items.map((i) => i.productId).filter((x): x is string => !!x))];
    const products = ids.length ? await app.prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, slug: true } }) : [];
    const slugById = new Map(products.map((p) => [p.id, p.slug]));
    const items = dto.items.map((it, idx) => ({ ...it, slug: order.items[idx].productId ? slugById.get(order.items[idx].productId!) ?? null : null }));
    return { ...dto, items };
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

  app.post('/api/account/reviews', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } }, preHandler: requireCustomer }, async (request, reply) => {
    const { productSlug, rating, title, body } = reviewBody.parse(request.body);
    const product = await app.prisma.product.findUnique({ where: { slug: productSlug }, select: { id: true } });
    if (!product) throw httpError(404, 'Product not found');
    const review = await upsertReview(app.prisma, request.customer!.id, product.id, request.customer!.name, { rating, title, body });
    return reply.status(201).send({ review: { id: review.id, rating: review.rating, title: review.title, body: review.body, status: review.status } });
  });

  app.get('/api/account/reviews/can-review', { preHandler: requireCustomer }, async (request) => {
    const { slug } = request.query as { slug?: string };
    if (!slug) throw httpError(400, 'slug is required');
    const product = await app.prisma.product.findUnique({ where: { slug }, select: { id: true } });
    if (!product) return { eligible: false, review: null };
    const eligible = await canReview(app.prisma, request.customer!.id, product.id);
    const existing = await app.prisma.review.findUnique({ where: { productId_customerId: { productId: product.id, customerId: request.customer!.id } } });
    return { eligible, review: existing ? { rating: existing.rating, title: existing.title, body: existing.body } : null };
  });

  registerAddressRoutes(app);
}
