import type { APIRoute } from 'astro';

const API = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:4000';

export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const res = await fetch(`${API}/api/auth/reset-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: form.get('email'), code: form.get('code'), newPassword: form.get('newPassword') }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Reset failed' }));
    return redirect(`/account/reset-password?error=${encodeURIComponent(err.message ?? 'Reset failed')}`);
  }
  return redirect('/account/login?reset=1');
};
