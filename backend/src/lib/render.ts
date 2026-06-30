import { Eta } from 'eta';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyReply } from 'fastify';
import type { SessionUser } from '../plugins/session';

const viewsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../modules/admin/views');
const eta = new Eta({ views: viewsDir, cache: false });

export interface PageOpts {
  template: string;
  title: string;
  user?: SessionUser;
  active?: string;
  csrf?: string;
  flash?: { type: 'error' | 'success'; message: string } | null;
  data?: Record<string, unknown>;
}

/** Render an admin page: inner template wrapped in the shared layout. */
export function renderPage(reply: FastifyReply, opts: PageOpts): FastifyReply {
  const body = eta.render(opts.template, { ...(opts.data ?? {}), csrf: opts.csrf, user: opts.user });
  const html = eta.render('layout', {
    title: opts.title,
    body,
    user: opts.user,
    active: opts.active ?? '',
    flash: opts.flash ?? null,
    csrf: opts.csrf,
  });
  return reply.type('text/html').send(html);
}
