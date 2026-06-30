import { buildApp } from './app';
import { env } from './env';

const app = await buildApp();

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  app.log.info(`Roots & Rings API listening on ${env.APP_URL} (docs at /docs)`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
