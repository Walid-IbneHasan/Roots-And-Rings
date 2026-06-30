import type { FastifyInstance, FastifyReply } from 'fastify';
import { renderPage } from '../../lib/render';
import { getUser, requireAdminSession } from './guards';
import { writeAudit } from '../../lib/audit';
import { normalizeCode } from '../coupons/service';
import type { CouponType } from '@prisma/client';

const blocked = (reply: FastifyReply, msg: string) =>
  reply
    .status(400)
    .type('text/html')
    .send(`<div style="font-family:Georgia,serif;padding:40px"><h1>Action blocked</h1><p>${msg}</p><p><a href="javascript:history.back()">← Back</a></p></div>`);

interface CouponForm {
  code?: string;
  type?: string;
  value?: string;
  description?: string;
  minOrderSubtotal?: string;
  maxRedemptions?: string;
  perCustomerLimit?: string;
  isActive?: string;
}

function parseForm(body: CouponForm) {
  const code = normalizeCode(String(body.code ?? ''));
  const type = (body.type === 'FIXED' ? 'FIXED' : 'PERCENT') as CouponType;
  const value = Number(body.value);
  const minOrderSubtotal = body.minOrderSubtotal ? Number(body.minOrderSubtotal) : 0;
  const maxRedemptions = body.maxRedemptions ? Number(body.maxRedemptions) : null;
  const perCustomerLimit = body.perCustomerLimit ? Number(body.perCustomerLimit) : null;
  return { code, type, value, minOrderSubtotal, maxRedemptions, perCustomerLimit, description: body.description?.trim() || null };
}

function validate(f: ReturnType<typeof parseForm>): string | null {
  if (!f.code) return 'Code is required.';
  if (!Number.isFinite(f.value) || f.value <= 0) return 'Value must be greater than zero.';
  if (f.type === 'PERCENT' && f.value > 100) return 'Percent value cannot exceed 100.';
  return null;
}

export function registerAdminCoupons(app: FastifyInstance) {
  const authed = { preHandler: requireAdminSession };
  const authedWrite = { preHandler: [requireAdminSession, app.csrfProtection] };

  app.get('/admin/coupons', authed, async (req, reply) => {
    const user = getUser(req)!;
    const csrf = reply.generateCsrf();
    const coupons = await app.prisma.coupon.findMany({ orderBy: { createdAt: 'desc' } });
    return renderPage(reply, { template: 'coupons-list', title: 'Coupons', user, active: 'coupons', csrf, data: { coupons } });
  });

  app.get('/admin/coupons/new', authed, async (req, reply) => {
    const user = getUser(req)!;
    const csrf = reply.generateCsrf();
    return renderPage(reply, { template: 'coupon-form', title: 'New coupon', user, active: 'coupons', csrf, data: { coupon: null } });
  });

  app.post('/admin/coupons', authedWrite, async (req, reply) => {
    const user = getUser(req)!;
    const f = parseForm(req.body as CouponForm);
    const err = validate(f);
    if (err) return blocked(reply, err);
    if (await app.prisma.coupon.findUnique({ where: { code: f.code } })) return blocked(reply, 'A coupon with that code already exists.');
    const created = await app.prisma.coupon.create({ data: f });
    await writeAudit(app.prisma, { actor: user, action: 'coupon.create', entity: 'Coupon', entityId: created.id, after: { code: f.code }, req });
    return reply.redirect('/admin/coupons');
  });

  app.get('/admin/coupons/:id/edit', authed, async (req, reply) => {
    const user = getUser(req)!;
    const { id } = req.params as { id: string };
    const coupon = await app.prisma.coupon.findUnique({ where: { id } });
    if (!coupon) return reply.redirect('/admin/coupons');
    const csrf = reply.generateCsrf();
    return renderPage(reply, { template: 'coupon-form', title: coupon.code, user, active: 'coupons', csrf, data: { coupon } });
  });

  app.post('/admin/coupons/:id', authedWrite, async (req, reply) => {
    const user = getUser(req)!;
    const { id } = req.params as { id: string };
    const existing = await app.prisma.coupon.findUnique({ where: { id } });
    if (!existing) return reply.redirect('/admin/coupons');
    const f = parseForm(req.body as CouponForm);
    const err = validate(f);
    if (err) return blocked(reply, err);
    const dupe = await app.prisma.coupon.findUnique({ where: { code: f.code } });
    if (dupe && dupe.id !== id) return blocked(reply, 'A coupon with that code already exists.');
    await app.prisma.coupon.update({ where: { id }, data: f });
    await writeAudit(app.prisma, { actor: user, action: 'coupon.update', entity: 'Coupon', entityId: id, after: { code: f.code }, req });
    return reply.redirect('/admin/coupons');
  });

  app.post('/admin/coupons/:id/deactivate', authedWrite, async (req, reply) => {
    const user = getUser(req)!;
    const { id } = req.params as { id: string };
    await app.prisma.coupon.update({ where: { id }, data: { isActive: false } });
    await writeAudit(app.prisma, { actor: user, action: 'coupon.deactivate', entity: 'Coupon', entityId: id, req });
    return reply.redirect('/admin/coupons');
  });
}
