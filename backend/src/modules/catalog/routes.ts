import type { FastifyInstance } from 'fastify';
import { getMenu } from '../../lib/menu-cache';
import { productsQuery, categoriesQuery } from './schemas';
import {
  listProducts,
  getProductBySlug,
  getRelated,
  getFeatured,
  getFlashProducts,
  getCollections,
  getCollectionBySlug,
  getFacets,
} from './service';

export default async function catalogRoutes(app: FastifyInstance) {
  app.get('/api/categories', async (request) => {
    const { kind } = categoriesQuery.parse(request.query);
    const menu = await getMenu(app.prisma);
    return kind ? menu.filter((m) => m.kind === kind) : menu;
  });

  app.get('/api/categories/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const category = await app.prisma.category.findUnique({ where: { slug } });
    if (!category) return reply.status(404).send({ error: 'NotFound', message: 'Category not found', statusCode: 404 });
    return category;
  });

  app.get('/api/collections', async () => getCollections(app.prisma));

  app.get('/api/collections/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const c = await getCollectionBySlug(app.prisma, slug);
    if (!c) return reply.status(404).send({ error: 'NotFound', message: 'Collection not found', statusCode: 404 });
    return c;
  });

  app.get('/api/products', async (request) => {
    const q = productsQuery.parse(request.query);
    return listProducts(app.prisma, q);
  });

  app.get('/api/products/flash', async () => getFlashProducts(app.prisma));

  app.get('/api/products/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const product = await getProductBySlug(app.prisma, slug);
    if (!product) return reply.status(404).send({ error: 'NotFound', message: 'Product not found', statusCode: 404 });
    return product;
  });

  app.get('/api/products/:slug/related', async (request) => {
    const { slug } = request.params as { slug: string };
    return getRelated(app.prisma, slug, 4);
  });

  app.get('/api/featured', async () => getFeatured(app.prisma));

  app.get('/api/facets', async () => getFacets(app.prisma));
}
