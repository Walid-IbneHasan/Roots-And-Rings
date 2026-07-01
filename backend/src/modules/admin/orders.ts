import type { FastifyInstance, FastifyReply } from 'fastify';
import { renderPage } from '../../lib/render';
import { getUser, requireAdminSession } from './guards';
import { canTransition, ORDER_TRANSITIONS } from '../../lib/order-state';
import { releaseReservations, restockOrder } from '../inventory/service';
import { markPaymentPaid, refundPayment } from '../payments/service';
import { writeAudit } from '../../lib/audit';
import type { OrderStatus } from '@prisma/client';
import { createManualOrder, type ManualOrderInput } from '../checkout/service';
import { listProducts } from '../catalog/service';

const rc = { isolationLevel: 'ReadCommitted' as const };
const blocked = (reply: FastifyReply, msg: string) =>
  reply.status(400).type('text/html').send(`<div style="font-family:Georgia,serif;padding:40px"><h1>Action blocked</h1><p>${msg}</p><p><a href="javascript:history.back()">← Back</a></p></div>`);

export function registerAdminOrders(app: FastifyInstance) {
  const authed = { preHandler: requireAdminSession };
  const authedWrite = { preHandler: [requireAdminSession, app.csrfProtection] };

  app.get('/admin/orders', authed, async (req, reply) => {
    const user = getUser(req)!;
    const csrf = reply.generateCsrf();
    const { status, q } = req.query as { status?: string; q?: string };
    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (q) where.OR = [{ orderNumber: { contains: q } }, { guestEmail: { contains: q } }];
    const orders = await app.prisma.order.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100, include: { payments: true } });
    return renderPage(reply, {
      template: 'orders-list',
      title: 'Orders',
      user,
      active: 'orders',
      csrf,
      data: { orders, status: status ?? '', q: q ?? '', statuses: Object.keys(ORDER_TRANSITIONS) },
    });
  });

  app.get('/admin/orders/new', authed, async (req, reply) => {
    const user = getUser(req)!;
    const csrf = reply.generateCsrf();
    const { items: products } = await listProducts(app.prisma, {});
    return renderPage(reply, { template: 'order-new', title: 'New order', user, active: 'orders', csrf, data: { products } });
  });

  app.post('/admin/orders/new', authedWrite, async (req, reply) => {
    const body = req.body as Record<string, string>;
    const source = body.source as ManualOrderInput['source'];
    if (!['WEBSITE', 'FACEBOOK', 'INSTAGRAM', 'OTHER'].includes(source)) return blocked(reply, 'Invalid source.');

    const active = await app.prisma.product.findMany({ where: { isActive: true }, select: { slug: true } });
    const items = active
      .map((p) => ({ slug: p.slug, qty: parseInt(body[`qty_${p.slug}`] || '0', 10) || 0 }))
      .filter((i) => i.qty > 0);
    if (!items.length) return blocked(reply, 'Add at least one product (quantity ≥ 1).');

    const name = (body.name || '').trim();
    const emailAddr = (body.email || '').trim();
    const phone = (body.phone || '').trim();
    const line1 = (body.line1 || '').trim();
    const city = (body.city || '').trim();
    const district = (body.district || '').trim();
    if (!name || !emailAddr || !phone || !line1 || !city || !district) {
      return blocked(reply, 'Name, email, phone, and shipping line1/city/district are required.');
    }

    const input: ManualOrderInput = {
      items,
      contact: { name, email: emailAddr, phone },
      shipping: {
        line1,
        line2: (body.line2 || '').trim() || undefined,
        city,
        district,
        postalCode: (body.postalCode || '').trim() || undefined,
      },
      source,
      paid: body.paid === 'on',
    };
    try {
      const { orderId } = await createManualOrder(app.prisma, input);
      return reply.redirect(`/admin/orders/${orderId}`);
    } catch (e) {
      return blocked(reply, e instanceof Error ? e.message : 'Could not create the order.');
    }
  });

  app.get('/admin/orders/:id', authed, async (req, reply) => {
    const user = getUser(req)!;
    const { id } = req.params as { id: string };
    const order = await app.prisma.order.findUnique({ where: { id }, include: { items: true, payments: true, shipment: true } });
    if (!order) return reply.redirect('/admin/orders');
    const csrf = reply.generateCsrf();
    return renderPage(reply, {
      template: 'order-detail',
      title: order.orderNumber,
      user,
      active: 'orders',
      csrf,
      data: { order, allowed: ORDER_TRANSITIONS[order.status] },
    });
  });

  app.post('/admin/orders/:id/status', authedWrite, async (req, reply) => {
    const user = getUser(req)!;
    const { id } = req.params as { id: string };
    const target = (req.body as { status?: string }).status as OrderStatus;
    const order = await app.prisma.order.findUnique({ where: { id } });
    if (!order) return reply.redirect('/admin/orders');
    if (!canTransition(order.status, target)) return blocked(reply, `Cannot move ${order.status} → ${target}.`);

    await app.prisma.$transaction(async (tx) => {
      await tx.order.update({ where: { id }, data: { status: target } });
      if (target === 'SHIPPED') await tx.shipment.updateMany({ where: { orderId: id }, data: { status: 'SHIPPED', shippedAt: new Date() } });
      if (target === 'DELIVERED') await tx.shipment.updateMany({ where: { orderId: id }, data: { status: 'DELIVERED', deliveredAt: new Date() } });
      if (target === 'CANCELLED') {
        await releaseReservations(tx, id);
        await restockOrder(tx, id, 'CANCELLATION_RESTOCK');
        await tx.shipment.updateMany({ where: { orderId: id }, data: { status: 'CANCELLED' } });
      }
    }, rc);

    // COD settle-to-PAID on delivery
    if (target === 'DELIVERED') {
      const pay = await app.prisma.payment.findFirst({ where: { orderId: id } });
      if (pay && pay.provider === 'COD' && pay.status !== 'PAID') await markPaymentPaid(app.prisma, id);
    }
    await writeAudit(app.prisma, { actor: user, action: 'order.status', entity: 'Order', entityId: id, before: { status: order.status }, after: { status: target }, req });
    return reply.redirect(`/admin/orders/${id}`);
  });

  app.post('/admin/orders/:id/refund', authedWrite, async (req, reply) => {
    const user = getUser(req)!;
    const { id } = req.params as { id: string };
    const amount = Number((req.body as { amount?: string }).amount ?? 0);
    const order = await app.prisma.order.findUnique({ where: { id }, include: { payments: true } });
    if (!order || !order.payments[0]) return reply.redirect('/admin/orders');
    if (!(amount > 0)) return blocked(reply, 'Refund amount must be greater than zero.');
    await refundPayment(app.prisma, order.payments[0].id, amount);
    await writeAudit(app.prisma, { actor: user, action: 'order.refund', entity: 'Order', entityId: id, after: { amount }, req });
    return reply.redirect(`/admin/orders/${id}`);
  });
}
