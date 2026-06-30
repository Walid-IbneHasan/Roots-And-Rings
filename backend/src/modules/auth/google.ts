import type { FastifyInstance } from 'fastify';
import type { Customer, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { OAuth2Client } from 'google-auth-library';
import { httpError } from '../../lib/errors';
import { signCustomerToken } from '../../lib/jwt';
import { customerDto } from './dto';
import { env } from '../../env';

const googleBody = z.object({ credential: z.string().min(1) });

export interface GoogleProfile {
  sub: string;
  email: string;
  name?: string;
  emailVerified: boolean;
}

let oauthClient: OAuth2Client | null = null;
function getClient(): OAuth2Client {
  return (oauthClient ??= new OAuth2Client(env.GOOGLE_CLIENT_ID));
}

/** Verify a Google ID token (signature/audience/issuer/expiry) and extract the profile. */
export async function verifyGoogleIdToken(credential: string): Promise<GoogleProfile> {
  const ticket = await getClient().verifyIdToken({ idToken: credential, audience: env.GOOGLE_CLIENT_ID });
  const p = ticket.getPayload();
  if (!p || !p.sub || !p.email) throw httpError(401, 'Invalid Google token');
  return { sub: p.sub, email: p.email, name: p.name, emailVerified: p.email_verified === true };
}

/** Resolve the customer: find by googleId → link by email → create. */
export async function resolveGoogleCustomer(
  prisma: PrismaClient,
  profile: { sub: string; email: string; name?: string },
): Promise<Customer> {
  const email = profile.email.toLowerCase();
  const existing = await prisma.customer.findUnique({ where: { googleId: profile.sub } });
  if (existing) return existing;
  const byEmail = await prisma.customer.findUnique({ where: { email } });
  if (byEmail) {
    return prisma.customer.update({
      where: { id: byEmail.id },
      data: { googleId: profile.sub, emailVerifiedAt: byEmail.emailVerifiedAt ?? new Date() },
    });
  }
  return prisma.customer.create({
    data: {
      email,
      name: profile.name?.trim() || email.split('@')[0],
      googleId: profile.sub,
      emailVerifiedAt: new Date(),
    },
  });
}

export function registerGoogleRoute(
  app: FastifyInstance,
  verify: (credential: string) => Promise<GoogleProfile> = verifyGoogleIdToken,
) {
  app.post(
    '/api/auth/google',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request) => {
      const { credential } = googleBody.parse(request.body);
      let profile: GoogleProfile;
      try {
        profile = await verify(credential);
      } catch {
        throw httpError(401, 'Google sign-in failed');
      }
      if (!profile.emailVerified) throw httpError(401, 'Your Google email is not verified');
      const customer = await resolveGoogleCustomer(app.prisma, profile);
      return { token: signCustomerToken(customer), customer: customerDto(customer) };
    },
  );
}
