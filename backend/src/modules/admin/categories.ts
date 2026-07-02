import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { CategoryKind } from '@prisma/client';
import { renderPage } from '../../lib/render';
import { getUser, requireAdminSession } from './guards';
import { uniqueSlug } from '../../lib/slug';
import { writeAudit } from '../../lib/audit';
import { invalidateMenu } from '../../lib/menu-cache';
import { uploadsService, type UploadKind } from '../uploads/service';

// kind is NOT part of the form — it is fixed by the route group (categories vs collections).
const bodySchema = z.object({
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

interface CrudCfg {
  basePath: string;
  kind: CategoryKind;
  active: string;
  showParent: boolean;
  countField: 'typeProducts' | 'collectionProducts';
  entity: string;
  label: string;
  heading: string;
  newLabel: string;
  sub: string;
}

export function registerAdminCategories(app: FastifyInstance) {
  const authed = { preHandler: requireAdminSession };
  const authedWrite = { preHandler: [requireAdminSession, app.csrfProtection] };

  function mount(cfg: CrudCfg) {
    app.get(cfg.basePath, authed, async (req, reply) => {
      const user = getUser(req)!;
      const csrf = reply.generateCsrf();
      const cats = await app.prisma.category.findMany({
        where: { kind: cfg.kind },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: { _count: { select: { typeProducts: true, collectionProducts: true } } },
      });
      return renderPage(reply, { template: 'categories', title: cfg.heading, user, active: cfg.active, csrf, data: { cats, cfg } });
    });

    app.get(cfg.basePath + '/new', authed, async (req, reply) => {
      const user = getUser(req)!;
      const csrf = reply.generateCsrf();
      const parents = cfg.showParent ? await app.prisma.category.findMany({ where: { kind: cfg.kind }, orderBy: { name: 'asc' } }) : [];
      return renderPage(reply, { template: 'category-form', title: 'New ' + cfg.label, user, active: cfg.active, csrf, data: { cat: null, parents, cfg } });
    });

    app.post(cfg.basePath + '/new', authedWrite, async (req, reply) => {
      const user = getUser(req)!;
      const d = bodySchema.parse(req.body);
      const slug = await uniqueSlug(d.slug || d.name, async (s) => Boolean(await app.prisma.category.findUnique({ where: { slug: s } })));
      const created = await app.prisma.category.create({
        data: {
          kind: cfg.kind, name: d.name, slug,
          parentId: cfg.showParent ? (d.parentId || null) : null,
          tagline: d.tagline || null, description: d.description || null,
          imageUrl: d.imageUrl || null, sortOrder: d.sortOrder, isActive: d.isActive,
          seoTitle: d.seoTitle || null, seoDescription: d.seoDescription || null,
        },
      });
      invalidateMenu();
      await writeAudit(app.prisma, { actor: user, action: 'create', entity: cfg.entity, entityId: created.id, after: created, req });
      return reply.redirect(cfg.basePath);
    });

    app.get(cfg.basePath + '/:id/edit', authed, async (req, reply) => {
      const user = getUser(req)!;
      const { id } = req.params as { id: string };
      const cat = await app.prisma.category.findFirst({ where: { id, kind: cfg.kind } });
      if (!cat) return reply.redirect(cfg.basePath);
      const csrf = reply.generateCsrf();
      const parents = cfg.showParent ? await app.prisma.category.findMany({ where: { kind: cfg.kind }, orderBy: { name: 'asc' } }) : [];
      return renderPage(reply, { template: 'category-form', title: 'Edit ' + cfg.label, user, active: cfg.active, csrf, data: { cat, parents, cfg } });
    });

    app.post(cfg.basePath + '/:id/edit', authedWrite, async (req, reply) => {
      const user = getUser(req)!;
      const { id } = req.params as { id: string };
      const before = await app.prisma.category.findFirst({ where: { id, kind: cfg.kind } });
      if (!before) return reply.redirect(cfg.basePath);
      const d = bodySchema.parse(req.body);
      let slug = d.slug ? d.slug : before.slug;
      if (slug !== before.slug) {
        slug = await uniqueSlug(slug, async (s) => Boolean(await app.prisma.category.findFirst({ where: { slug: s, id: { not: id } } })));
      }
      const updated = await app.prisma.category.update({
        where: { id },
        data: {
          name: d.name, slug,
          parentId: cfg.showParent && d.parentId && d.parentId !== id ? d.parentId : null,
          tagline: d.tagline || null, description: d.description || null, imageUrl: d.imageUrl || null,
          sortOrder: d.sortOrder, isActive: d.isActive, seoTitle: d.seoTitle || null, seoDescription: d.seoDescription || null,
        },
      });
      invalidateMenu();
      await writeAudit(app.prisma, { actor: user, action: 'update', entity: cfg.entity, entityId: id, before, after: updated, req });
      return reply.redirect(cfg.basePath);
    });

    app.post(cfg.basePath + '/:id/delete', authedWrite, async (req, reply) => {
      const user = getUser(req)!;
      const { id } = req.params as { id: string };
      const before = await app.prisma.category.findFirst({ where: { id, kind: cfg.kind } });
      if (before) {
        await app.prisma.category.delete({ where: { id } });
        invalidateMenu();
        await writeAudit(app.prisma, { actor: user, action: 'delete', entity: cfg.entity, entityId: id, before, req });
      }
      return reply.redirect(cfg.basePath);
    });
  }

  mount({ basePath: '/admin/categories', kind: 'PRODUCT_TYPE', active: 'categories', showParent: true, countField: 'typeProducts', entity: 'Category', label: 'Category', heading: 'Categories', newLabel: 'New category', sub: 'Product types.' });
  mount({ basePath: '/admin/collections', kind: 'COLLECTION', active: 'collections', showParent: false, countField: 'collectionProducts', entity: 'Collection', label: 'Collection', heading: 'Collections', newLabel: 'New collection', sub: 'Curated groupings of products.' });

  const UPLOAD_KINDS: UploadKind[] = ['products', 'categories', 'avatars'];
  app.post('/admin/uploads/image', { preHandler: requireAdminSession }, async (req, reply) => {
    const raw = (req.query as { kind?: string }).kind;
    const kind: UploadKind = UPLOAD_KINDS.includes(raw as UploadKind) ? (raw as UploadKind) : 'categories';
    const file = await req.file();
    if (!file) return reply.status(400).send({ error: 'BadRequest', message: 'No image provided', statusCode: 400 });
    const out = await uploadsService.processImage(await file.toBuffer(), kind);
    return reply.send({ url: out.url, width: out.width, height: out.height });
  });
}
