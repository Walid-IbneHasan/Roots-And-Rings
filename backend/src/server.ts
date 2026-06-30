import { buildApp } from './app';
import { env } from './env';
import { startJobWorker } from './modules/notifications/worker';

const app = await buildApp();

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  app.log.info(`Roots & Rings API listening on ${env.APP_URL} (docs at /docs)`);
  if (env.JOBS_WORKER_ENABLED) {
    startJobWorker(app.prisma, {
      intervalMs: env.JOBS_POLL_INTERVAL_MS,
      batchSize: env.JOBS_BATCH_SIZE,
      staleLockMs: env.JOBS_STALE_LOCK_MS,
    });
    app.log.info(`Job worker started (every ${env.JOBS_POLL_INTERVAL_MS}ms, batch ${env.JOBS_BATCH_SIZE})`);
  }
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
