import type { PrismaClient } from '@prisma/client';
import { processJobs } from './jobs';

let timer: ReturnType<typeof setInterval> | null = null;

/** Start the in-process job worker (idempotent). Polls every intervalMs and drains a batch. */
export function startJobWorker(prisma: PrismaClient, opts: { intervalMs: number; batchSize: number }): void {
  if (timer) return;
  timer = setInterval(() => {
    processJobs(prisma, opts.batchSize).catch((e) => console.error('[jobs] worker tick failed', e));
  }, opts.intervalMs);
  // Don't keep the process alive just for the worker.
  timer.unref();
}

export function stopJobWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
