import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { renderPage } from '../../lib/render';
import { getUser, requireAdminSession } from './guards';
import { uniqueSlug } from '../../lib/slug';
import { writeAudit } from '../../lib/audit';
import { invalidateMenu } from '../../lib/menu-cache';

const bodySchema = z.object({
  kind: z.enum(['PRODUCT_TYPE', 'COLLECTION']),
  name: z.string().trim().min(1),
  slug: z.string().trim().optional(),
  parentId: z.string().trim().optional(),
  tagline: z.string().trim().optional(),
  description: z.string().trim().optional(),
  imageUrl: z.string().trim().optional(),
  sortOrder: z.coerce.number().int().default(0),
  isActive: z.string().optional().transform((v) => v === 'on'),
  seoTitle: z.string().trim().optional(),
  seoDescription: z.string().trim().optional(),
});

export function registerAdminCategories(app: FastifyInstance) {
  const authed = { preHandler: requireAdminSession };
  const authedWrite = { preHandler: [requireAdminSession, app.csrfProtection] };

  app.get('/admin/categories', authed, async (req, reply) => {
    const user = getUser(req)!;
    const csrf = reply.generateCsrf();
    const cats = await app.prisma.category.findMany({
      orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { typeProducts: true, collectionProducts: true } } },
    });
    return renderPage(reply, { template: 'categories', title: 'Categories', user, active: 'categories', csrf, data: { cats } });
  });

  app.get('/admin/categories/new', authed, async (req, reply) => {
    const user = getUser(req)!;
    const csrf = reply.generateCsrf();
    const parents = await app.prisma.category.findMany({ orderBy: { name: 'asc' } });
    return renderPage(reply, { template: 'category-form', title: 'New Category', user, active: 'categories', csrf, data: { cat: null, parents } });
  });

  app.post('/admin/categories/new', authedWrite, async (req, reply) => {
    const user = getUser(req)!;
    const d = bodySchema.parse(req.body);
    const slug = await uniqueSlug(d.slug || d.name, async (s) => Boolean(await app.prisma.category.findUnique({ where: { slug: s } })));
    const created = await app.prisma.category.create({
      data: {
        kind: d.kind, name: d.name, slug,
        parentId: d.parentId || null, tagline: d.tagline || null, description: d.description || null,
        imageUrl: d.imageUrl || null, sortOrder: d.sortOrder, isActive: d.isActive,
        seoTitle: d.seoTitle || null, seoDescription: d.seoDescription || null,
      },
    });
    invalidateMenu();
    await writeAudit(app.prisma, { actor: user, action: 'create', entity: 'Category', entityId: created.id, after: created, req });
    return reply.redirect('/admin/categories');
  });

  app.get('/admin/categories/:id/edit', authed, async (req, reply) => {
    const user = getUser(req)!;
    const { id } = req.params as { id: string };
    const cat = await app.prisma.category.findUnique({ where: { id } });
    if (!cat) return reply.redirect('/admin/categories');
    const csrf = reply.generateCsrf();
    const parents = await app.prisma.category.findMany({ orderBy: { name: 'asc' } });
    return renderPage(reply, { template: 'category-form', title: 'Edit Category', user, active: 'categories', csrf, data: { cat, parents } });
  });

  app.post('/admin/categories/:id/edit', authedWrite, async (req, reply) => {
    const user = getUser(req)!;
    const { id } = req.params as { id: string };
    const before = await app.prisma.category.findUnique({ where: { id } });
    if (!before) return reply.redirect('/admin/categories');
    const d = bodySchema.parse(req.body);
    let slug = d.slug ? d.slug : before.slug;
    if (slug !== before.slug) {
      slug = await uniqueSlug(slug, async (s) => Boolean(await app.prisma.category.findFirst({ where: { slug: s, id: { not: id } } })));
    }
    const updated = await app.prisma.category.update({
      where: { id },
      data: {
        kind: d.kind, name: d.name, slug,
        parentId: d.parentId && d.parentId !== id ? d.parentId : null,
        tagline: d.tagline || null, description: d.description || null, imageUrl: d.imageUrl || null,
        sortOrder: d.sortOrder, isActive: d.isActive, seoTitle: d.seoTitle || null, seoDescription: d.seoDescription || null,
      },
    });
    invalidateMenu();
    await writeAudit(app.prisma, { actor: user, action: 'update', entity: 'Category', entityId: id, before, after: updated, req });
    return reply.redirect('/admin/categories');
  });

  app.post('/admin/categories/:id/delete', authedWrite, async (req, reply) => {
    const user = getUser(req)!;
    const { id } = req.params as { id: string };
    const before = await app.prisma.category.findUnique({ where: { id } });
    if (before) {
      await app.prisma.category.delete({ where: { id } });
      invalidateMenu();
      await writeAudit(app.prisma, { actor: user, action: 'delete', entity: 'Category', entityId: id, before, req });
    }
    return reply.redirect('/admin/categories');
  });
}
