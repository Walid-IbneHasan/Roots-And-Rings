import type { APIRoute } from 'astro';
import { SESSION_COOKIE } from '../../../lib/auth';

const API = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:4000';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const form = await request.formData();
  const token = cookies.get(SESSION_COOKIE)?.value;
  if (!token) return redirect('/account/login');
  const res = await fetch(`${API}/api/auth/verify-email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ code: form.get('code') }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Verification failed' }));
    return redirect(`/account/verify-email?error=${encodeURIComponent(err.message ?? 'Verification failed')}`);
  }
  return redirect('/account?verified=1');
};
