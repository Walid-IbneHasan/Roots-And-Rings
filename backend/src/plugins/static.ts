import fp from 'fastify-plugin';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));

// Serves uploaded media (WebP) at /uploads/*
export default fp(async (app) => {
  await app.register(fastifyStatic, {
    root: path.join(dir, '../../uploads'),
    prefix: '/uploads/',
  });
});
