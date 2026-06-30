import type { PrismaClient, Prisma, MovementType } from '@prisma/client';
import { OutOfStockError } from './errors';

type Db = PrismaClient | Prisma.TransactionClient;
type Tx = Prisma.TransactionClient;

export interface ReserveItem {
  variantId: string;
  quantity: number;
}

/** stock − Σ(ACTIVE reservations). */
export async function availableStock(db: Db, variantId: string): Promise<number> {
  const v = await db.productVariant.findUnique({ where: { id: variantId }, select: { stock: true } });
  if (!v) return 0;
  const agg = await db.inventoryReservation.aggregate({
    where: { variantId, status: 'ACTIVE' },
    _sum: { quantity: true },
  });
  return v.stock - (agg._sum.quantity ?? 0);
}

/**
 * Reserve stock for an order. Must run inside an interactive transaction (preferably
 * ReadCommitted). Locks each variant row with SELECT … FOR UPDATE so concurrent
 * reservations serialize and cannot oversell.
 */
export async function reserveForOrder(tx: Tx, orderId: string, items: ReserveItem[], ttlMinutes = 30): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
  for (const item of items) {
    const rows = await tx.$queryRawUnsafe<{ stock: number; allowBackorder: number }[]>(
      `SELECT v.stock AS stock, p.allowBackorder AS allowBackorder
       FROM ProductVariant v JOIN Product p ON p.id = v.productId
       WHERE v.id = ? FOR UPDATE`,
      item.variantId,
    );
    const row = rows[0];
    if (!row) throw new OutOfStockError(item.variantId);

    const agg = await tx.inventoryReservation.aggregate({
      where: { variantId: item.variantId, status: 'ACTIVE' },
      _sum: { quantity: true },
    });
    const reserved = agg._sum.quantity ?? 0;
    const available = row.stock - reserved;
    const allowBackorder = Number(row.allowBackorder) === 1;

    if (available < item.quantity && !allowBackorder) {
      throw new OutOfStockError(item.variantId);
    }

    await tx.inventoryReservation.create({
      data: { variantId: item.variantId, orderId, quantity: item.quantity, status: 'ACTIVE', expiresAt },
    });
    await tx.inventoryMovement.create({
      data: { variantId: item.variantId, type: 'RESERVATION', quantity: -item.quantity, orderId },
    });
  }
}

/** Convert ACTIVE reservations → COMMITTED, decrement stock, write SALE movements. */
export async function commitReservations(tx: Tx, orderId: string): Promise<void> {
  const reservations = await tx.inventoryReservation.findMany({ where: { orderId, status: 'ACTIVE' } });
  for (const r of reservations) {
    await tx.inventoryReservation.update({ where: { id: r.id }, data: { status: 'COMMITTED' } });
    await tx.productVariant.update({ where: { id: r.variantId }, data: { stock: { decrement: r.quantity } } });
    await tx.inventoryMovement.create({
      data: { variantId: r.variantId, type: 'SALE', quantity: -r.quantity, orderId },
    });
  }
}

/** Release ACTIVE reservations (e.g., abandoned/expired/cancelled-before-commit). */
export async function releaseReservations(tx: Tx, orderId: string): Promise<void> {
  const reservations = await tx.inventoryReservation.findMany({ where: { orderId, status: 'ACTIVE' } });
  for (const r of reservations) {
    await tx.inventoryReservation.update({ where: { id: r.id }, data: { status: 'RELEASED' } });
    await tx.inventoryMovement.create({
      data: { variantId: r.variantId, type: 'RESERVATION_RELEASE', quantity: r.quantity, orderId },
    });
  }
}

/** Restock a committed order (refund or cancellation): increment stock back. */
export async function restockOrder(tx: Tx, orderId: string, type: 'REFUND_RESTOCK' | 'CANCELLATION_RESTOCK'): Promise<void> {
  const reservations = await tx.inventoryReservation.findMany({ where: { orderId, status: 'COMMITTED' } });
  for (const r of reservations) {
    await tx.inventoryReservation.update({ where: { id: r.id }, data: { status: 'RELEASED' } });
    await tx.productVariant.update({ where: { id: r.variantId }, data: { stock: { increment: r.quantity } } });
    await tx.inventoryMovement.create({
      data: { variantId: r.variantId, type: type as MovementType, quantity: r.quantity, orderId },
    });
  }
}

/** Manual admin adjustment. delta can be +/-. */
export async function adjustStock(prisma: PrismaClient, variantId: string, delta: number, reason: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.productVariant.update({ where: { id: variantId }, data: { stock: { increment: delta } } });
    await tx.inventoryMovement.create({
      data: { variantId, type: 'MANUAL_ADJUSTMENT', quantity: delta, reason },
    });
  });
  await checkLowStock(prisma, variantId);
}

/** Upsert a LowStockNotification when stock ≤ threshold (open one if none unresolved). */
export async function checkLowStock(prisma: Db, variantId: string): Promise<void> {
  const v = await prisma.productVariant.findUnique({ where: { id: variantId }, select: { stock: true, lowStockThreshold: true } });
  if (!v) return;
  if (v.stock <= v.lowStockThreshold) {
    const open = await prisma.lowStockNotification.findFirst({ where: { variantId, resolvedAt: null } });
    if (!open) {
      await prisma.lowStockNotification.create({ data: { variantId, threshold: v.lowStockThreshold, notifiedAt: new Date() } });
    }
  } else {
    await prisma.lowStockNotification.updateMany({ where: { variantId, resolvedAt: null }, data: { resolvedAt: new Date() } });
  }
}
