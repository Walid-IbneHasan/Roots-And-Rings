import fp from 'fastify-plugin';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import cors from '@fastify/cors';
import { env } from '../env';

export default fp(async (app) => {
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        // Admin panel + Swagger UI use inline scripts/styles in dev.
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    // Allow the storefront (different origin) to load /uploads images.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });

  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
  });

  await app.register(cors, {
    origin: env.STOREFRONT_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
});
