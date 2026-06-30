import type { FastifyInstance } from 'fastify';
import { verifyPassword } from '../../lib/password';
import { renderPage } from '../../lib/render';
import { getUser, setUser } from './guards';

export function registerAdminAuth(app: FastifyInstance) {
  app.get('/admin/login', async (req, reply) => {
    if (getUser(req)) return reply.redirect('/admin');
    const csrf = reply.generateCsrf();
    return renderPage(reply, { template: 'login', title: 'Sign in', csrf, data: { error: null } });
  });

  app.post(
    '/admin/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = (req.body ?? {}) as { email?: string; password?: string };
      const email = String(body.email ?? '').trim().toLowerCase();
      const user = await app.prisma.user.findUnique({ where: { email } });
      const ok = Boolean(user) && user!.isActive && (await verifyPassword(String(body.password ?? ''), user!.passwordHash));
      if (!ok || !user) {
        const csrf = reply.generateCsrf();
        reply.status(401);
        return renderPage(reply, { template: 'login', title: 'Sign in', csrf, data: { error: 'Invalid credentials', email } });
      }
      setUser(req, { id: user.id, email: user.email, name: user.name, role: user.role });
      await app.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      return reply.redirect('/admin');
    },
  );

  app.post('/admin/logout', { preHandler: app.csrfProtection }, async (req, reply) => {
    await new Promise<void>((resolve) => {
      req.session.destroy(() => resolve());
    });
    return reply.redirect('/admin/login');
  });
}
