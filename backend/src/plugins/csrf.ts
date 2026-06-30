import fp from 'fastify-plugin';
import csrf from '@fastify/csrf-protection';

// Requires the session plugin to be registered first (stores the CSRF secret in session).
export default fp(async (app) => {
  await app.register(csrf, {
    sessionPlugin: '@fastify/session',
  });
});
