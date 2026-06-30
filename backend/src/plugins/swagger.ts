import fp from 'fastify-plugin';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

export default fp(async (app) => {
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Roots & Rings API',
        description: 'Public catalog API for the Roots & Rings storefront.',
        version: '0.1.0',
      },
      tags: [{ name: 'catalog', description: 'Public catalog endpoints' }, { name: 'system' }],
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });
});
