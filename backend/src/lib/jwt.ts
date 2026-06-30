import jwt from 'jsonwebtoken';
import { env } from '../env';

export interface CustomerClaims {
  sub: string;
  email: string;
  name: string;
}

export function signCustomerToken(c: { id: string; email: string; name: string }): string {
  return jwt.sign({ email: c.email, name: c.name }, env.JWT_SECRET, {
    subject: c.id,
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

export function verifyCustomerToken(token: string): CustomerClaims {
  const p = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload;
  return { sub: String(p.sub), email: String(p.email), name: String(p.name) };
}
