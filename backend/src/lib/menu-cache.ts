import type { PrismaClient } from '@prisma/client';

export interface MenuNode {
  id: string;
  kind: 'PRODUCT_TYPE' | 'COLLECTION';
  name: string;
  slug: string;
  imageUrl: string | null;
  children: MenuNode[];
}

let cache: { data: MenuNode[]; at: number } | null = null;
const TTL_MS = 60_000;

/** Cached category tree (60s TTL), built without a per-request query. */
export async function getMenu(prisma: PrismaClient): Promise<MenuNode[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;

  const cats = await prisma.category.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });

  const byId = new Map<string, MenuNode>();
  for (const c of cats) {
    byId.set(c.id, { id: c.id, kind: c.kind, name: c.name, slug: c.slug, imageUrl: c.imageUrl, children: [] });
  }
  const roots: MenuNode[] = [];
  for (const c of cats) {
    const node = byId.get(c.id)!;
    if (c.parentId && byId.has(c.parentId)) byId.get(c.parentId)!.children.push(node);
    else roots.push(node);
  }

  cache = { data: roots, at: Date.now() };
  return roots;
}

export function invalidateMenu(): void {
  cache = null;
}
