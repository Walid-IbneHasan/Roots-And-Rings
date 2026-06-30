import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { reclaimStaleJobs } from '../src/modules/notifications/jobs';

const prisma = new PrismaClient();

beforeAll(async () => {
  await prisma.job.deleteMany({ where: { type: { in: ['test.reclaim-stale', 'test.reclaim-fresh'] } } });
});
afterAll(async () => {
  await prisma.job.deleteMany({ where: { type: { in: ['test.reclaim-stale', 'test.reclaim-fresh'] } } });
  await prisma.$disconnect();
});

describe('reclaimStaleJobs', () => {
  it('resets a stale PROCESSING job to PENDING and leaves a recent one alone', async () => {
    const stale = await prisma.job.create({
      data: { type: 'test.reclaim-stale', payload: {}, status: 'PROCESSING', lockedAt: new Date(Date.now() - 10 * 60_000) },
    });
    const fresh = await prisma.job.create({
      data: { type: 'test.reclaim-fresh', payload: {}, status: 'PROCESSING', lockedAt: new Date() },
    });

    const count = await reclaimStaleJobs(prisma, 5 * 60_000);
    expect(count).toBeGreaterThanOrEqual(1);

    const s = await prisma.job.findUnique({ where: { id: stale.id } });
    const f = await prisma.job.findUnique({ where: { id: fresh.id } });
    expect(s!.status).toBe('PENDING');
    expect(s!.lockedAt).toBeNull();
    expect(f!.status).toBe('PROCESSING'); // recent lock untouched
  });
});
