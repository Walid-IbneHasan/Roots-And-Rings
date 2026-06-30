import fp from 'fastify-plugin';
import cookie from '@fastify/cookie';
import session from '@fastify/session';
import { env } from '../env';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'STAFF';
}

declare module '@fastify/session' {
  interface FastifySessionObject {
    user?: SessionUser;
  }
}

export default fp(async (app) => {
  await app.register(cookie, { secret: env.COOKIE_SECRET });
  await app.register(session, {
    secret: env.SESSION_SECRET,
    cookieName: 'rr_admin_sid',
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.NODE_ENV === 'production',
      path: '/',
      maxAge: 1000 * 60 * 60 * 8, // 8h
    },
  });
});
