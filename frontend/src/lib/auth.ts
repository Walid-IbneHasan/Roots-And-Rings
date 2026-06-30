import jwt from 'jsonwebtoken';
import type { AstroGlobal } from 'astro';

const SECRET = import.meta.env.JWT_SECRET ?? process.env.JWT_SECRET ?? '';
export const SESSION_COOKIE = 'rr_session';

export interface Session {
  sub: string;
  email: string;
  name: string;
}

export function verifySession(token: string): Session | null {
  if (!SECRET) return null;
  try {
    const p = jwt.verify(token, SECRET) as jwt.JwtPayload;
    return { sub: String(p.sub), email: String(p.email), name: String(p.name) };
  } catch {
    return null;
  }
}

export function getSession(Astro: AstroGlobal): Session | null {
  const token = Astro.cookies.get(SESSION_COOKIE)?.value;
  return token ? verifySession(token) : null;
}

export function bearer(Astro: AstroGlobal): string | undefined {
  return Astro.cookies.get(SESSION_COOKIE)?.value;
}
