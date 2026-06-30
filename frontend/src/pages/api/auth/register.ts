import type { APIRoute } from 'astro';
import { SESSION_COOKIE } from '../../../lib/auth';

const API = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:4000';
const WEEK = 60 * 60 * 24 * 7;

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const form = await request.formData();
  const res = await fetch(`${API}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: form.get('name'), email: form.get('email'), password: form.get('password') }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Registration failed' }));
    return redirect(`/account/register?error=${encodeURIComponent(err.message ?? 'Registration failed')}`);
  }
  const data = await res.json();
  cookies.set(SESSION_COOKIE, data.token, { httpOnly: true, sameSite: 'lax', path: '/', secure: import.meta.env.PROD, maxAge: WEEK });
  return redirect('/account/verify-email?welcome=1');
};
