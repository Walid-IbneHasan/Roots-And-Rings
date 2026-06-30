import type { APIRoute } from 'astro';
import { SESSION_COOKIE } from '../../../lib/auth';

const API = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:4000';
const WEEK = 60 * 60 * 24 * 7;

export const POST: APIRoute = async ({ request, cookies }) => {
  const { credential, next } = await request.json().catch(() => ({ credential: '', next: '/account' }));
  // Local-path-only guard (same as login.ts) so `next` can't become an open redirect.
  const safeNext =
    typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') && next.charCodeAt(1) !== 92
      ? next
      : '/account';
  const res = await fetch(`${API}/api/auth/google`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ credential }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Google sign-in failed' }));
    return new Response(JSON.stringify({ ok: false, message: err.message ?? 'Google sign-in failed' }), {
      status: res.status,
      headers: { 'content-type': 'application/json' },
    });
  }
  const data = await res.json();
  cookies.set(SESSION_COOKIE, data.token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: import.meta.env.PROD,
    maxAge: WEEK,
  });
  return new Response(JSON.stringify({ ok: true, next: safeNext }), {
    headers: { 'content-type': 'application/json' },
  });
};
