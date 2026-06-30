import type { FastifyReply, FastifyRequest } from 'fastify';
import type { SessionUser } from '../../plugins/session';

export function getUser(req: FastifyRequest): SessionUser | undefined {
  return (req.session as unknown as { user?: SessionUser }).user;
}

export function setUser(req: FastifyRequest, user: SessionUser | undefined): void {
  (req.session as unknown as { user?: SessionUser }).user = user;
}

export async function requireAdminSession(req: FastifyRequest, reply: FastifyReply) {
  if (!getUser(req)) return reply.redirect('/admin/login');
}

export function requireRole(role: 'ADMIN' | 'STAFF') {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const user = getUser(req);
    if (!user) return reply.redirect('/admin/login');
    if (user.role !== role) {
      reply.status(403).type('text/html');
      return reply.send(
        '<div style="font-family:Georgia,serif;padding:40px"><h1>403 — Forbidden</h1><p>This action requires Admin privileges.</p><p><a href="/admin">← Back</a></p></div>',
      );
    }
  };
}
