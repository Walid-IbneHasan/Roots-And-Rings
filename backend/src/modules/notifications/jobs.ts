import type { PrismaClient } from '@prisma/client';
import { sendMail } from './email';
import { renderOrderConfirmation } from './templates';

export async function enqueueJob(prisma: PrismaClient, type: string, payload: object) {
  return prisma.job.create({ data: { type, payload } });
}

/**
 * Reclaim jobs orphaned in PROCESSING by a crashed worker: any job locked longer than `staleMs`
 * is reset to PENDING so the next tick retries it. Only touches stale PROCESSING rows.
 */
export async function reclaimStaleJobs(prisma: PrismaClient, staleMs: number): Promise<number> {
  const cutoff = new Date(Date.now() - staleMs);
  const res = await prisma.job.updateMany({
    where: { status: 'PROCESSING', lockedAt: { lt: cutoff } },
    data: { status: 'PENDING', lockedAt: null },
  });
  return res.count;
}

export type HandlerFn = (prisma: PrismaClient, type: string, payload: Record<string, unknown>) => Promise<void>;

async function defaultHandle(prisma: PrismaClient, type: string, payload: Record<string, unknown>): Promise<void> {
  if (type === 'email.order_confirmation') {
    const order = await prisma.order.findUnique({ where: { id: String(payload.orderId) }, include: { items: true, payments: true } });
    if (!order) return;
    const { subject, html, text } = renderOrderConfirmation({
      orderNumber: order.orderNumber,
      guestEmail: order.guestEmail,
      grandTotal: order.grandTotal,
      items: order.items.map((i) => ({ productName: i.productName, variantName: i.variantName, quantity: i.quantity, lineTotal: i.lineTotal })),
      cod: order.payments[0]?.provider === 'COD',
    });
    await sendMail({ to: order.guestEmail, subject, html, text });
  }
  // unknown types: no-op
}

/**
 * Drain up to `batchSize` due PENDING jobs. Claims with SELECT … FOR UPDATE SKIP LOCKED so
 * concurrent workers never grab the same job (no double-send). On failure, retries with backoff
 * (runAt += attempts·60s) until maxAttempts, then marks FAILED.
 */
export async function processJobs(
  prisma: PrismaClient,
  batchSize: number,
  handler: HandlerFn = defaultHandle,
): Promise<{ processed: number; failed: number }> {
  const limit = Math.max(1, Math.floor(batchSize));
  const now = new Date();
  const claimedIds = await prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM Job WHERE status = 'PENDING' AND runAt <= ? ORDER BY runAt ASC LIMIT ${limit} FOR UPDATE SKIP LOCKED`,
        now,
      );
      const ids = rows.map((r) => r.id);
      if (ids.length) await tx.job.updateMany({ where: { id: { in: ids } }, data: { status: 'PROCESSING', lockedAt: now } });
      return ids;
    },
    { isolationLevel: 'ReadCommitted' },
  );

  let processed = 0;
  let failed = 0;
  for (const id of claimedIds) {
    const job = await prisma.job.findUnique({ where: { id } });
    if (!job) continue;
    try {
      await handler(prisma, job.type, job.payload as Record<string, unknown>);
      await prisma.job.update({ where: { id }, data: { status: 'DONE', attempts: { increment: 1 }, lockedAt: null } });
      processed++;
    } catch (e) {
      const attempts = job.attempts + 1;
      const willRetry = attempts < job.maxAttempts;
      await prisma.job.update({
        where: { id },
        data: {
          status: willRetry ? 'PENDING' : 'FAILED',
          attempts,
          lastError: String(e),
          lockedAt: null,
          ...(willRetry ? { runAt: new Date(Date.now() + attempts * 60_000) } : {}),
        },
      });
      failed++;
    }
  }
  return { processed, failed };
}
