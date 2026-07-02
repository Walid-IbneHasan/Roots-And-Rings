import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { renderPage } from '../../lib/render';
import { getUser, requireAdminSession } from './guards';
import { uniqueSlug } from '../../lib/slug';
import { sanitizeRichText } from '../../lib/sanitize';
import { writeAudit } from '../../lib/audit';
import { uploadsService } from '../uploads/service';
import { adjustStock } from '../inventory/service';
import type { SessionUser } from '../../plugins/session';
import type { PrismaClient } from '@prisma/client';

const optNum = z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().optional());
const optInt = z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().int().optional());
const optStr = z.preprocess((v) => (v === '' || v == null ? undefined : v), z.string().optional());

const productBody = z.object({
  name: z.string().trim().min(1),
  slug: optStr,
  sku: z.string().trim().min(1),
  subtitle: optStr,
  bodyType: optStr,
  badges: z.union([z.string(), z.array(z.string())]).optional(),
  shortDescription: z.string().trim().min(1),
  description: z.string().optional().default(''),
  basePrice: z.coerce.number().nonnegative(),
  salePrice: optNum,
  flashPrice: optNum,
  flashStartAt: optStr,
  flashEndAt: optStr,
  currency: z.string().default('BDT'),
  isActive: z.string().optional().transform((v) => v === 'on'),
  isFeatured: z.string().optional().transform((v) => v === 'on'),
  featuredOrder: optInt,
  allowBackorder: z.string().optional().transform((v) => v === 'on'),
  minPerOrder: z.preprocess((v) => (v === '' || v == null ? 1 : v), z.coerce.number().int().min(1)),
  maxPerOrder: optInt,
  categoryId: optStr,
  collectionIds: z.union([z.string(), z.array(z.string())]).optional(),
  curatorsNote: optStr,
  specDimensions: optStr,
  specWeight: optStr,
  specBodyType: optStr,
  seoTitle: optStr,
  seoDescription: optStr,
  publishedAt: optStr,
  stock: optInt,
});

/** Upsert the product's default "Standard" variant and set its stock (movement-audited). */
async function syncDefaultVariant(prisma: PrismaClient, productId: string, sku: string, stock: number | undefined): Promise<void> {
  if (stock == null) return;
  const vsku = `${sku}-V`;
  const existing = await prisma.productVariant.findUnique({ where: { sku: vsku } });
  if (existing) {
    const delta = stock - existing.stock;
    if (delta !== 0) await adjustStock(prisma, existing.id, delta, 'admin edit');
  } else {
    await prisma.productVariant.create({ data: { productId, sku: vsku, name: 'Standard', stock, lowStockThreshold: 1 } });
  }
}

const BADGE_VALUES = ['Limited Edition', 'Made to Order'];
const toArr = (v: unknown): string[] => (v == null ? [] : Array.isArray(v) ? (v as string[]) : [String(v)]);
const toDate = (s?: string): Date | null => (s ? new Date(s) : null);

async function formData(app: FastifyInstance) {
  const [categories, collections] = await Promise.all([
    app.prisma.category.findMany({ where: { kind: 'PRODUCT_TYPE' }, orderBy: { sortOrder: 'asc' } }),
    app.prisma.category.findMany({ where: { kind: 'COLLECTION' }, orderBy: { sortOrder: 'asc' } }),
  ]);
  return { categories, collections, badgeValues: BADGE_VALUES };
}

function buildData(d: z.infer<typeof productBody>) {
  const specs = {
    dimensions: d.specDimensions ?? '',
    weight: d.specWeight ?? '',
    bodyType: d.specBodyType ?? '',
  };
  return {
    name: d.name,
    sku: d.sku,
    subtitle: d.subtitle ?? null,
    bodyType: d.bodyType ?? null,
    badges: toArr(d.badges).filter((b) => BADGE_VALUES.includes(b)),
    shortDescription: d.shortDescription,
    description: sanitizeRichText(d.description ?? ''),
    basePrice: d.basePrice,
    salePrice: d.salePrice ?? null,
    flashPrice: d.flashPrice ?? null,
    flashStartAt: toDate(d.flashStartAt),
    flashEndAt: toDate(d.flashEndAt),
    currency: d.currency || 'BDT',
    isActive: d.isActive,
    isFeatured: d.isFeatured,
    featuredOrder: d.isFeatured ? d.featuredOrder ?? 0 : null,
    allowBackorder: d.allowBackorder,
    minPerOrder: d.minPerOrder,
    maxPerOrder: d.maxPerOrder ?? null,
    specs,
    curatorsNote: d.curatorsNote ?? null,
    seoTitle: d.seoTitle ?? null,
    seoDescription: d.seoDescription ?? null,
    publishedAt: toDate(d.publishedAt),
    categoryId: d.categoryId || null,
  };
}

interface ImgRow {
  id: string;
  url: string;
  isPrimary: boolean;
}
function imagesHtml(product: { id?: string; images?: ImgRow[] } | null, csrf: string): string {
  if (!product || !product.id) return '';
  const base = `/admin/products/${product.id}`;
  const items = (product.images ?? [])
    .map((im) => {
      const primary = im.isPrimary
        ? '<span class="pill">Primary</span>'
        : `<form method="post" action="${base}/images/${im.id}/primary"><input type="hidden" name="_csrf" value="${csrf}" /><button class="btn ghost sm" type="submit">Primary</button></form>`;
      return `<figure><img src="${im.url}" alt="" /><div style="display:flex;gap:6px;margin-top:6px">${primary}<form method="post" action="${base}/images/${im.id}/delete"><input type="hidden" name="_csrf" value="${csrf}" /><button class="btn danger sm" type="submit">Remove</button></form></div></figure>`;
    })
    .join('');
  return `<h2 style="margin-top:36px">Images</h2><form method="post" action="${base}/images" enctype="multipart/form-data" style="display:flex;gap:12px;align-items:center;margin-bottom:8px"><input type="file" name="image" accept=".jpg,.jpeg,.png,.webp" required /><button class="btn sm" type="submit">Upload</button></form><div class="imgrow">${items}</div>`;
}

async function renderForm(
  app: FastifyInstance,
  reply: FastifyReply,
  user: SessionUser,
  csrf: string,
  product: unknown,
  flash?: { type: 'error' | 'success'; message: string },
) {
  const fd = await formData(app);
  const p = product as { id?: string; sku?: string } | null;
  let defaultStock: number | null = null;
  if (p?.id && p.sku) {
    const v = await app.prisma.productVariant.findUnique({ where: { sku: `${p.sku}-V` }, select: { stock: true } });
    defaultStock = v?.stock ?? null;
  }
  return renderPage(reply, {
    template: 'product-form',
    title: product ? 'Edit Product' : 'New Product',
    user,
    active: 'products',
    csrf,
    flash,
    data: { product, ...fd, defaultStock, imagesHtml: imagesHtml(product as { id?: string; images?: ImgRow[] } | null, csrf) },
  });
}

export function registerAdminProducts(app: FastifyInstance) {
  const authed = { preHandler: requireAdminSession };
  const authedWrite = { preHandler: [requireAdminSession, app.csrfProtection] };

  app.get('/admin/products', authed, async (req, reply) => {
    const user = getUser(req)!;
    const csrf = reply.generateCsrf();
    const q = (req.query as { q?: string }).q?.trim();
    const products = await app.prisma.product.findMany({
      where: q ? { name: { contains: q } } : undefined,
      orderBy: { createdAt: 'desc' },
      include: { category: true, images: { where: { isPrimary: true }, take: 1 } },
    });
    return renderPage(reply, { template: 'products-list', title: 'Products', user, active: 'products', csrf, data: { products, q: q ?? '' } });
  });

  app.get('/admin/products/new', authed, async (req, reply) => {
    const user = getUser(req)!;
    const csrf = reply.generateCsrf();
    return renderForm(app, reply, user, csrf, null);
  });

  app.post('/admin/products/new', authedWrite, async (req, reply) => {
    const user = getUser(req)!;
    const csrf = reply.generateCsrf();
    const d = productBody.parse(req.body);
    const data = buildData(d);
    try {
      const slug = await uniqueSlug(d.slug || d.name, async (s) => Boolean(await app.prisma.product.findUnique({ where: { slug: s } })));
      const created = await app.prisma.product.create({
        data: { ...data, slug, collections: { connect: toArr(d.collectionIds).map((id) => ({ id })) } },
      });
      await syncDefaultVariant(app.prisma, created.id, created.sku, d.stock ?? 0);
      await writeAudit(app.prisma, { actor: user, action: 'create', entity: 'Product', entityId: created.id, after: { slug, name: created.name }, req });
      return reply.redirect(`/admin/products/${created.id}/edit`);
    } catch (e) {
      reply.status(400);
      return renderForm(app, reply, user, csrf, { ...data, badges: data.badges, collections: [], images: [] }, { type: 'error', message: `Could not save — ${(e as Error).message.includes('sku') ? 'SKU already exists' : 'check the fields'}.` });
    }
  });

  app.get('/admin/products/:id/edit', authed, async (req, reply) => {
    const user = getUser(req)!;
    const { id } = req.params as { id: string };
    const product = await app.prisma.product.findUnique({ where: { id }, include: { images: { orderBy: { position: 'asc' } }, collections: true } });
    if (!product) return reply.redirect('/admin/products');
    const csrf = reply.generateCsrf();
    return renderForm(app, reply, user, csrf, product);
  });

  app.post('/admin/products/:id/edit', authedWrite, async (req, reply) => {
    const user = getUser(req)!;
    const { id } = req.params as { id: string };
    const before = await app.prisma.product.findUnique({ where: { id } });
    if (!before) return reply.redirect('/admin/products');
    const csrf = reply.generateCsrf();
    const d = productBody.parse(req.body);
    const data = buildData(d);
    try {
      let slug = d.slug || before.slug;
      if (slug !== before.slug) {
        slug = await uniqueSlug(slug, async (s) => Boolean(await app.prisma.product.findFirst({ where: { slug: s, id: { not: id } } })));
      }
      const updated = await app.prisma.product.update({
        where: { id },
        data: { ...data, slug, collections: { set: toArr(d.collectionIds).map((cid) => ({ id: cid })) } },
      });
      await syncDefaultVariant(app.prisma, id, updated.sku, d.stock);
      await writeAudit(app.prisma, { actor: user, action: 'update', entity: 'Product', entityId: id, before: { slug: before.slug, name: before.name }, after: { slug: updated.slug, name: updated.name }, req });
      return reply.redirect('/admin/products');
    } catch (e) {
      reply.status(400);
      const product = await app.prisma.product.findUnique({ where: { id }, include: { images: { orderBy: { position: 'asc' } }, collections: true } });
      return renderForm(app, reply, user, csrf, product, { type: 'error', message: `Could not save — ${(e as Error).message.includes('sku') ? 'SKU already exists' : 'check the fields'}.` });
    }
  });

  app.post('/admin/products/:id/delete', authedWrite, async (req, reply) => {
    const user = getUser(req)!;
    const { id } = req.params as { id: string };
    const before = await app.prisma.product.findUnique({ where: { id } });
    if (before) {
      await app.prisma.product.delete({ where: { id } });
      await writeAudit(app.prisma, { actor: user, action: 'delete', entity: 'Product', entityId: id, before: { slug: before.slug, name: before.name }, req });
    }
    return reply.redirect('/admin/products');
  });

  // --- Images ---
  app.post('/admin/products/:id/images', { preHandler: requireAdminSession }, async (req, reply) => {
    const user = getUser(req)!;
    const { id } = req.params as { id: string };
    const product = await app.prisma.product.findUnique({ where: { id }, include: { images: true } });
    if (!product) return reply.redirect('/admin/products');
    const file = await req.file();
    if (!file) return reply.redirect(`/admin/products/${id}/edit`);
    const buffer = await file.toBuffer();
    const out = await uploadsService.processImage(buffer, 'products');
    const position = product.images.length;
    await app.prisma.productImage.create({
      data: { productId: id, url: out.url, width: out.width, height: out.height, position, isPrimary: product.images.length === 0, alt: product.name },
    });
    await writeAudit(app.prisma, { actor: user, action: 'image.add', entity: 'Product', entityId: id, after: { url: out.url }, req });
    return reply.redirect(`/admin/products/${id}/edit`);
  });

  app.post('/admin/products/:id/images/:imageId/delete', authedWrite, async (req, reply) => {
    const { id, imageId } = req.params as { id: string; imageId: string };
    await app.prisma.productImage.deleteMany({ where: { id: imageId, productId: id } });
    return reply.redirect(`/admin/products/${id}/edit`);
  });

  app.post('/admin/products/:id/images/:imageId/primary', authedWrite, async (req, reply) => {
    const { id, imageId } = req.params as { id: string; imageId: string };
    await app.prisma.$transaction([
      app.prisma.productImage.updateMany({ where: { productId: id }, data: { isPrimary: false } }),
      app.prisma.productImage.update({ where: { id: imageId }, data: { isPrimary: true } }),
    ]);
    return reply.redirect(`/admin/products/${id}/edit`);
  });
}
