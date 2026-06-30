import type { PrismaClient } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import type { SessionUser } from '../plugins/session';

export interface AuditInput {
  actor?: SessionUser;
  action: string;
  entity: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  req?: FastifyRequest;
}

/** Immutable admin audit entry. before/after stored as JSON snapshots. */
export async function writeAudit(prisma: PrismaClient, input: AuditInput): Promise<void> {
  await prisma.adminAuditLog.create({
    data: {
      actorUserId: input.actor?.id ?? null,
      actorEmail: input.actor?.email ?? 'system',
      action: input.action,
      entity: input.entity,
      entityId: input.entityId ?? null,
      ...(input.before !== undefined ? { before: input.before as object } : {}),
      ...(input.after !== undefined ? { after: input.after as object } : {}),
      ip: input.req?.ip ?? null,
      userAgent: (input.req?.headers['user-agent'] as string | undefined) ?? null,
    },
  });
}
