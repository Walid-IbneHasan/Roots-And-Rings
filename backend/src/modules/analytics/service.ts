import type { PrismaClient } from '@prisma/client';

export type Period = 'daily' | 'weekly' | 'monthly';

const WINDOW_DAYS: Record<Period, number> = { daily: 30, weekly: 84, monthly: 365 };

export function windowStart(period: Period, now: Date = new Date()): Date {
  return new Date(now.getTime() - WINDOW_DAYS[period] * 24 * 60 * 60 * 1000);
}

// Live orders only (Prisma where fragment + raw-SQL fragment kept in sync).
const LIVE_STATUSES = ['CANCELLED', 'FAILED', 'EXPIRED', 'REFUNDED'];
const LIVE_WHERE = { status: { notIn: LIVE_STATUSES as any } };
const LIVE_SQL = "status NOT IN ('CANCELLED','FAILED','EXPIRED','REFUNDED')";
const BD = 'DATE_ADD(createdAt, INTERVAL 6 HOUR)'; // Asia/Dhaka, no DST

export async function getSummary(prisma: PrismaClient, period: Period) {
  const agg = await prisma.order.aggregate({
    where: { ...LIVE_WHERE, createdAt: { gte: windowStart(period) } },
    _count: { _all: true },
    _sum: { grandTotal: true },
  });
  const orders = agg._count._all;
  const revenue = Number(agg._sum.grandTotal ?? 0);
  return { orders, revenue, aov: orders ? revenue / orders : 0 };
}

export async function getOrdersByChannel(prisma: PrismaClient, period: Period) {
  const rows = await prisma.order.groupBy({
    by: ['source'],
    where: { ...LIVE_WHERE, createdAt: { gte: windowStart(period) } },
    _count: { _all: true },
    _sum: { grandTotal: true },
  });
  const by = new Map(rows.map((r) => [r.source as string, { orders: r._count._all, revenue: Number(r._sum.grandTotal ?? 0) }]));
  return (['WEBSITE', 'FACEBOOK', 'INSTAGRAM', 'OTHER'] as const).map((source) => ({
    source, orders: by.get(source)?.orders ?? 0, revenue: by.get(source)?.revenue ?? 0,
  }));
}

export async function getSalesOverTime(prisma: PrismaClient, period: Period) {
  const start = windowStart(period);
  let sql: string;
  if (period === 'daily') {
    // ANY_VALUE(): label is functionally dependent on DATE(BD) (same calendar day -> same
    // formatted string), but MySQL's ONLY_FULL_GROUP_BY detector can't infer that across a
    // DATE_FORMAT/DATE function pair, so it must be told explicitly.
    sql = "SELECT ANY_VALUE(DATE_FORMAT(" + BD + ", '%b %e')) AS label, COUNT(*) AS orders, COALESCE(SUM(grandTotal),0) AS revenue "
      + "FROM `Order` WHERE " + LIVE_SQL + " AND createdAt >= ? "
      + "GROUP BY DATE(" + BD + ") ORDER BY DATE(" + BD + ") ASC";
  } else if (period === 'weekly') {
    sql = "SELECT DATE_FORMAT(MIN(" + BD + "), '%b %e') AS label, COUNT(*) AS orders, COALESCE(SUM(grandTotal),0) AS revenue "
      + "FROM `Order` WHERE " + LIVE_SQL + " AND createdAt >= ? "
      + "GROUP BY YEARWEEK(" + BD + ", 3) ORDER BY MIN(" + BD + ") ASC";
  } else {
    // Same ANY_VALUE() rationale as the 'daily' branch above, for the '%Y-%m' vs '%b %Y' pair.
    sql = "SELECT ANY_VALUE(DATE_FORMAT(" + BD + ", '%b %Y')) AS label, COUNT(*) AS orders, COALESCE(SUM(grandTotal),0) AS revenue "
      + "FROM `Order` WHERE " + LIVE_SQL + " AND createdAt >= ? "
      + "GROUP BY DATE_FORMAT(" + BD + ", '%Y-%m') ORDER BY MIN(" + BD + ") ASC";
  }
  const rows = await prisma.$queryRawUnsafe<{ label: string; orders: bigint; revenue: string }[]>(sql, start);
  return rows.map((r) => ({ label: r.label, orders: Number(r.orders), revenue: Number(r.revenue) }));
}

export async function getPeakHours(prisma: PrismaClient, period: Period) {
  const rows = await prisma.$queryRawUnsafe<{ hour: number; orders: bigint }[]>(
    "SELECT HOUR(" + BD + ") AS hour, COUNT(*) AS orders FROM `Order` "
    + "WHERE " + LIVE_SQL + " AND createdAt >= ? GROUP BY hour ORDER BY hour",
    windowStart(period),
  );
  const map = new Map(rows.map((r) => [Number(r.hour), Number(r.orders)]));
  return Array.from({ length: 24 }, (_, h) => ({ hour: h, orders: map.get(h) ?? 0 }));
}

export async function getPeakWeekdays(prisma: PrismaClient, period: Period) {
  const rows = await prisma.$queryRawUnsafe<{ weekday: number; orders: bigint }[]>(
    "SELECT DAYOFWEEK(" + BD + ") AS weekday, COUNT(*) AS orders FROM `Order` "
    + "WHERE " + LIVE_SQL + " AND createdAt >= ? GROUP BY weekday ORDER BY weekday",
    windowStart(period),
  );
  const map = new Map(rows.map((r) => [Number(r.weekday), Number(r.orders)]));
  return Array.from({ length: 7 }, (_, i) => ({ weekday: i + 1, orders: map.get(i + 1) ?? 0 }));
}
