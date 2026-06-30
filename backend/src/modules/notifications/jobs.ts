import type { PrismaClient } from '@prisma/client';

export async function enqueueJob(prisma: PrismaClient, type: string, payload: object) {
  return prisma.job.create({ data: { type, payload } });
}

async function handle(prisma: PrismaClient, type: string, payload: Record<string, unknown>): Promise<void> {
  if (type === 'email.order_confirmation') {
    const order = await prisma.order.findUnique({ where: { id: String(payload.orderId) }, include: { items: true } });
    if (!order) return;
    // No-op email (logs) until SMTP is configured (Phase 3). Buyer + store inbox copy.
    console.log(
      `[email] Order confirmation ${order.orderNumber} → ${order.guestEmail} ` +
        `(${order.items.length} item(s), ৳${Number(order.grandTotal)}). Copy → store inbox.`,
    );
  }
}

/** Run a single job inline (a real cron-drained worker loop is Phase 3). */
export async function runJobInline(prisma: PrismaClient, jobId: string): Promise<void> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return;
  try {
    await handle(prisma, job.type, job.payload as Record<string, unknown>);
    await prisma.job.update({ where: { id: jobId }, data: { status: 'DONE', attempts: { increment: 1 } } });
  } catch (e) {
    await prisma.job.update({ where: { id: jobId }, data: { status: 'FAILED', lastError: String(e), attempts: { increment: 1 } } });
  }
}
