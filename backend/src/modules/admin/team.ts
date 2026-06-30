import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { renderPage } from '../../lib/render';
import { getUser, requireAdminSession, requireRole } from './guards';
import { hashPassword } from '../../lib/password';
import { writeAudit } from '../../lib/audit';

const blocked = (reply: import('fastify').FastifyReply, msg: string) =>
  reply.status(400).type('text/html').send(`<div style="font-family:Georgia,serif;padding:40px"><h1>Action blocked</h1><p>${msg}</p><p><a href="/admin/team">← Back to Team</a></p></div>`);

export function registerAdminTeam(app: FastifyInstance) {
  const authed = { preHandler: requireAdminSession };
  const adminOnly = { preHandler: [requireRole('ADMIN'), app.csrfProtection] };

  async function activeAdminCount() {
    return app.prisma.user.count({ where: { role: 'ADMIN', isActive: true } });
  }

  app.get('/admin/team', authed, async (req, reply) => {
    const user = getUser(req)!;
    const csrf = reply.generateCsrf();
    const users = await app.prisma.user.findMany({ orderBy: [{ role: 'asc' }, { createdAt: 'asc' }] });
    return renderPage(reply, { template: 'team', title: 'Team', user, active: 'team', csrf, data: { users, canManage: user.role === 'ADMIN', meId: user.id } });
  });

  app.post('/admin/team', adminOnly, async (req, reply) => {
    const actor = getUser(req)!;
    const d = z
      .object({ email: z.string().email(), name: z.string().trim().min(1), role: z.enum(['ADMIN', 'STAFF']), password: z.string().min(8) })
      .parse(req.body);
    const passwordHash = await hashPassword(d.password);
    try {
      const created = await app.prisma.user.create({
        data: { email: d.email.toLowerCase(), name: d.name, role: d.role, passwordHash, isActive: true },
      });
      await writeAudit(app.prisma, { actor, action: 'create', entity: 'User', entityId: created.id, after: { email: created.email, role: created.role }, req });
    } catch {
      return blocked(reply, 'A user with that email already exists.');
    }
    return reply.redirect('/admin/team');
  });

  app.post('/admin/team/:id/role', adminOnly, async (req, reply) => {
    const actor = getUser(req)!;
    const { id } = req.params as { id: string };
    const d = z.object({ role: z.enum(['ADMIN', 'STAFF']) }).parse(req.body);
    const target = await app.prisma.user.findUnique({ where: { id } });
    if (!target) return reply.redirect('/admin/team');
    if (target.role === 'ADMIN' && d.role !== 'ADMIN' && (await activeAdminCount()) <= 1) {
      return blocked(reply, 'You cannot demote the last remaining Admin.');
    }
    await app.prisma.user.update({ where: { id }, data: { role: d.role } });
    await writeAudit(app.prisma, { actor, action: 'role.change', entity: 'User', entityId: id, before: { role: target.role }, after: { role: d.role }, req });
    return reply.redirect('/admin/team');
  });

  app.post('/admin/team/:id/delete', adminOnly, async (req, reply) => {
    const actor = getUser(req)!;
    const { id } = req.params as { id: string };
    const target = await app.prisma.user.findUnique({ where: { id } });
    if (!target) return reply.redirect('/admin/team');
    if (target.role === 'ADMIN' && (await activeAdminCount()) <= 1) {
      return blocked(reply, 'You cannot delete the last remaining Admin.');
    }
    await app.prisma.user.delete({ where: { id } });
    await writeAudit(app.prisma, { actor, action: 'delete', entity: 'User', entityId: id, before: { email: target.email, role: target.role }, req });
    return reply.redirect('/admin/team');
  });
}
