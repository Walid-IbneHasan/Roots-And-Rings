import type { Prisma, PrismaClient, Review } from '@prisma/client';
import { sanitizeRichText } from '../../lib/sanitize';
import { ReviewError } from './errors';

type Db = PrismaClient | Prisma.TransactionClient;

/** True iff the customer has this product in a DELIVERED order of theirs. */
export async function canReview(db: Db, customerId: string, productId: string): Promise<boolean> {
  const item = await db.orderItem.findFirst({
    where: { productId, order: { customerId, status: 'DELIVERED' } },
    select: { id: true },
  });
  return item != null;
}

/** Recompute the denormalized rating from PUBLISHED reviews. */
export async function recomputeProductRating(db: Db, productId: string): Promise<void> {
  const agg = await db.review.aggregate({
    where: { productId, status: 'PUBLISHED' },
    _avg: { rating: true },
    _count: true,
  });
  const count = agg._count;
  const avg = count > 0 && agg._avg.rating != null ? Math.round(agg._avg.rating * 100) / 100 : null;
  await db.product.update({ where: { id: productId }, data: { ratingAvg: avg, ratingCount: count } });
}

export interface ReviewInput {
  rating: number;
  title?: string;
  body?: string;
}

/** Purchase-gated upsert (one review per product+customer). Re-publishes + recomputes the aggregate. */
export async function upsertReview(db: Db, customerId: string, productId: string, authorName: string, input: ReviewInput): Promise<Review> {
  if (!(await canReview(db, customerId, productId))) {
    throw new ReviewError(403, 'You can review this once your order has been delivered.');
  }
  const body = input.body ? sanitizeRichText(input.body) : null;
  const title = input.title?.trim() || null;
  const review = await db.review.upsert({
    where: { productId_customerId: { productId, customerId } },
    update: { rating: input.rating, title, body, authorName, status: 'PUBLISHED' },
    create: { productId, customerId, rating: input.rating, title, body, authorName, status: 'PUBLISHED' },
  });
  await recomputeProductRating(db, productId);
  return review;
}
