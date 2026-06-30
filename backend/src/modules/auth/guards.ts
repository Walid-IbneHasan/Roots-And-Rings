import type { FastifyRequest } from 'fastify';
import type { Customer } from '@prisma/client';
import { verifyCustomerToken, type CustomerClaims } from '../../lib/jwt';
import { httpError } from '../../lib/errors';

declare module 'fastify' {
  interface FastifyRequest {
    customerClaims?: CustomerClaims;
    customer?: Customer;
  }
}

function readBearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return null;
  return h.slice(7).trim() || null;
}

/** Optional auth: attach claims if a valid token is present; never throws. */
export async function customerContext(req: FastifyRequest): Promise<void> {
  const token = readBearer(req);
  if (!token) return;
  try {
    req.customerClaims = verifyCustomerToken(token);
  } catch {
    /* anonymous — ignore an invalid token */
  }
}

/** Required auth: verify token, load the customer, assert active. */
export async function requireCustomer(req: FastifyRequest): Promise<void> {
  const token = readBearer(req);
  if (!token) throw httpError(401, 'Authentication required');
  let claims: CustomerClaims;
  try {
    claims = verifyCustomerToken(token);
  } catch {
    throw httpError(401, 'Invalid or expired session');
  }
  const customer = await req.server.prisma.customer.findUnique({ where: { id: claims.sub } });
  if (!customer || !customer.isActive) throw httpError(401, 'Account not found or inactive');
  req.customer = customer;
}
