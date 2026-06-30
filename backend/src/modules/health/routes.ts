import type { FastifyInstance } from 'fastify';

export default async function healthRoutes(app: FastifyInstance) {
  app.get('/api/health', { config: { rateLimit: false } }, async () => {
    let db = false;
    try {
      await app.prisma.$queryRaw`SELECT 1`;
      db = true;
    } catch {
      db = false;
    }
    return { status: 'ok' as const, db };
  });
}
