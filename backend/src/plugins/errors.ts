import fp from 'fastify-plugin';
import { ZodError } from 'zod';

// Structured JSON errors; never leak internals on 5xx.
export default fp(async (app) => {
  app.setErrorHandler((err, request, reply) => {
    if (err instanceof ZodError) {
      reply.status(400).send({
        error: 'ValidationError',
        message: 'Invalid input',
        issues: err.flatten(),
        statusCode: 400,
      });
      return;
    }
    const status = err.statusCode ?? 500;
    if (status >= 500) {
      request.log.error({ err }, 'unhandled error');
    }
    reply.status(status).send({
      error: err.name || 'Error',
      message: status >= 500 ? 'Internal Server Error' : err.message,
      statusCode: status,
    });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({ error: 'NotFound', message: 'Route not found', statusCode: 404 });
  });
});
