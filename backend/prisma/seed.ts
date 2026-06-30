import { PrismaClient, type CategoryKind } from '@prisma/client';
import { copyFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../src/env';
import { hashPassword } from '../src/lib/password';
import { slugify } from '../src/lib/slug';
// DRY: reuse the existing storefront seed data.
import { products as feProducts } from '../../frontend/src/data/products';
import { collections as feCollections } from '../../frontend/src/data/collections';

const dir = path.dirname(fileURLToPath(import.meta.url));
const FE_IMAGES = path.join(dir, '../../frontend/src/assets/images');
const UPLOADS = path.join(dir, '../uploads');

const prisma = new PrismaClient();

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Copy a frontend image stem into uploads/<kind>/ and return its public URL (or null if missing). */
async function copyImage(stem: string, kind: 'products' | 'categories'): Promise<string | null> {
  const src = path.join(FE_IMAGES, `${stem}.jpg`);
  if (!(await fileExists(src))) return null;
  const destDir = path.join(UPLOADS, kind);
  await mkdir(destDir, { recursive: true });
  await copyFile(src, path.join(destDir, `${stem}.jpg`));
  return `/uploads/${kind}/${stem}.jpg`;
}

const PRODUCT_TYPES = ['Vessels', 'Bowls', 'Plates', 'Sculptural', 'Tableware'];

async function main() {
  await mkdir(path.join(UPLOADS, 'products'), { recursive: true });
  await mkdir(path.join(UPLOADS, 'categories'), { recursive: true });
  await mkdir(path.join(UPLOADS, 'avatars'), { recursive: true });

  // --- Admin ---
  const passwordHash = await hashPassword(env.ADMIN_PASSWORD);
  await prisma.user.upsert({
    where: { email: env.ADMIN_EMAIL },
    update: { role: 'ADMIN', isActive: true, passwordHash },
    create: { email: env.ADMIN_EMAIL, name: 'Administrator', role: 'ADMIN', isActive: true, passwordHash },
  });

  // --- Demo customer ---
  const demoEmail = 'customer@rootsandrings.example';
  await prisma.customer.upsert({
    where: { email: demoEmail },
    update: {},
    create: {
      email: demoEmail,
      name: 'Demo Customer',
      passwordHash: await hashPassword('ChangeMe123!'),
      emailVerifiedAt: new Date(),
    },
  });
  console.log(`Seeded demo customer: ${demoEmail} / ChangeMe123!`);

  // --- PRODUCT_TYPE categories ---
  const typeIdByName = new Map<string, string>();
  for (let i = 0; i < PRODUCT_TYPES.length; i++) {
    const name = PRODUCT_TYPES[i];
    const slug = slugify(name);
    const imageUrl = await copyImage(`category-${slug}`, 'categories');
    const cat = await prisma.category.upsert({
      where: { slug },
      update: { name, kind: 'PRODUCT_TYPE' as CategoryKind, sortOrder: i, isActive: true, ...(imageUrl ? { imageUrl } : {}) },
      create: { name, slug, kind: 'PRODUCT_TYPE' as CategoryKind, sortOrder: i, isActive: true, imageUrl },
    });
    typeIdByName.set(name, cat.id);
  }

  // --- COLLECTION categories ---
  const collectionIdBySlug = new Map<string, string>();
  for (let i = 0; i < feCollections.length; i++) {
    const c = feCollections[i];
    const imageUrl = await copyImage(c.image.src, 'categories');
    const cat = await prisma.category.upsert({
      where: { slug: c.slug },
      update: {
        name: c.name,
        kind: 'COLLECTION' as CategoryKind,
        tagline: c.tagline,
        description: c.description,
        sortOrder: i,
        isActive: true,
        ...(imageUrl ? { imageUrl } : {}),
      },
      create: {
        name: c.name,
        slug: c.slug,
        kind: 'COLLECTION' as CategoryKind,
        tagline: c.tagline,
        description: c.description,
        sortOrder: i,
        isActive: true,
        imageUrl,
      },
    });
    collectionIdBySlug.set(c.slug, cat.id);
  }

  // --- Products ---
  let featuredOrder = 0;
  for (const p of feProducts) {
    const categoryId = typeIdByName.get(p.category) ?? null;

    // Heuristic collection membership
    const collectionSlugs = new Set<string>();
    if (p.featured || ['the-kura-vessel', 'ash-glazed-vessel-no-1', 'tasting-plates-set'].includes(p.slug)) {
      collectionSlugs.add('the-first-firing');
    }
    if (['Tableware', 'Plates', 'Bowls'].includes(p.category)) collectionSlugs.add('quiet-table');
    if (p.clayBody === 'Porcelain') collectionSlugs.add('porcelain-light');
    const collectionIds = [...collectionSlugs]
      .map((s) => collectionIdBySlug.get(s))
      .filter((x): x is string => Boolean(x))
      .map((id) => ({ id }));

    const sku = `RR-${p.slug.toUpperCase()}`;
    const data = {
      name: p.name,
      slug: p.slug,
      sku,
      subtitle: p.subtitle ?? null,
      shortDescription: p.shortDescription,
      description: p.description,
      clayBody: p.clayBody ?? null,
      badges: p.badges ?? [],
      basePrice: p.price,
      currency: 'BDT',
      allowBackorder: (p.badges ?? []).includes('Made to Order'),
      isActive: true,
      isFeatured: Boolean(p.featured),
      featuredOrder: p.featured ? featuredOrder++ : null,
      specs: p.specs ?? {},
      edition: p.edition ?? undefined,
      curatorsNote: p.curatorsNote ?? null,
      seenInInteriors: p.seenInInteriors ?? undefined,
      publishedAt: new Date(p.createdAt),
      createdAt: new Date(p.createdAt),
      ...(categoryId ? { categoryId } : {}),
    };

    const product = await prisma.product.upsert({
      where: { slug: p.slug },
      update: { ...data, collections: { set: collectionIds } },
      create: { ...data, collections: { connect: collectionIds } },
    });

    // Images: rebuild from scratch (idempotent)
    await prisma.productImage.deleteMany({ where: { productId: product.id } });
    for (let i = 0; i < p.images.length; i++) {
      const img = p.images[i];
      const url = await copyImage(img.src, 'products');
      if (!url) continue;
      await prisma.productImage.create({
        data: { productId: product.id, url, alt: img.alt, position: i, isPrimary: i === 0 },
      });
    }

    // Default variant + stock (Phase 2)
    const madeToOrder = (p.badges ?? []).includes('Made to Order');
    const editionCount = (p.edition && typeof p.edition === 'object' && 'count' in (p.edition as Record<string, unknown>))
      ? Number((p.edition as { count: number }).count)
      : null;
    const stock = madeToOrder ? 0 : editionCount ?? 1;
    const lowStockThreshold = madeToOrder ? 0 : editionCount ? 3 : 1;
    const variantSku = `${product.sku}-V`;
    await prisma.productVariant.upsert({
      where: { sku: variantSku },
      update: { stock, lowStockThreshold, isActive: true },
      create: { productId: product.id, sku: variantSku, name: 'Standard', stock, lowStockThreshold, position: 0, isActive: true },
    });
  }

  const counts = {
    users: await prisma.user.count(),
    categories: await prisma.category.count(),
    products: await prisma.product.count(),
    images: await prisma.productImage.count(),
  };
  console.log('✔ Seed complete:', counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
