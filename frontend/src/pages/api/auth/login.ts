import type { APIRoute } from 'astro';
import { SESSION_COOKIE } from '../../../lib/auth';

const API = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:4000';
const WEEK = 60 * 60 * 24 * 7;

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const form = await request.formData();
  const next = String(form.get('next') || '/account');
  // Local-path only: reject off-site (`https://…`), protocol-relative (`//…`) and
  // backslash (`/\…`) targets so `next` can't become an open redirect. Plain string
  // checks (charCode 92 = backslash) — a regex literal here gets mangled by the build.
  const safeNext =
    next.startsWith('/') && !next.startsWith('//') && next.charCodeAt(1) !== 92 ? next : '/account';
  const res = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Login failed' }));
    return redirect(`/account/login?error=${encodeURIComponent(err.message ?? 'Login failed')}&next=${encodeURIComponent(safeNext)}`);
  }
  const data = await res.json();
  cookies.set(SESSION_COOKIE, data.token, { httpOnly: true, sameSite: 'lax', path: '/', secure: import.meta.env.PROD, maxAge: WEEK });
  return redirect(safeNext);
};
