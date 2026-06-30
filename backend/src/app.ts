import Fastify, { type FastifyInstance } from 'fastify';
import formbody from '@fastify/formbody';
import multipart from '@fastify/multipart';
import { env } from './env';
import errorsPlugin from './plugins/errors';
import prismaPlugin from './plugins/prisma';
import securityPlugin from './plugins/security';
import sessionPlugin from './plugins/session';
import csrfPlugin from './plugins/csrf';
import staticPlugin from './plugins/static';
import swaggerPlugin from './plugins/swagger';
import healthRoutes from './modules/health/routes';
import authRoutes from './modules/auth/routes';
import accountRoutes from './modules/account/routes';
import catalogRoutes from './modules/catalog/routes';
import checkoutRoutes from './modules/checkout/routes';
import ordersRoutes from './modules/orders/routes';
import cronRoutes from './modules/cron/routes';
import { registerAdmin } from './modules/admin';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: env.NODE_ENV === 'test' ? false : { level: 'info' },
    trustProxy: true,
    bodyLimit: 12 * 1024 * 1024, // 12MB (covers image uploads via multipart too)
  });

  app.decorateRequest('customerClaims', undefined);
  app.decorateRequest('customer', undefined);

  await app.register(errorsPlugin);
  await app.register(formbody);
  await app.register(multipart, { limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
  await app.register(prismaPlugin);
  await app.register(securityPlugin);
  await app.register(sessionPlugin);
  await app.register(csrfPlugin);
  await app.register(swaggerPlugin);
  await app.register(staticPlugin);

  // Public API
  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(accountRoutes);
  await app.register(catalogRoutes);
  await app.register(checkoutRoutes);
  await app.register(ordersRoutes);
  await app.register(cronRoutes);

  // Server-rendered admin panel
  await registerAdmin(app);

  return app;
}
