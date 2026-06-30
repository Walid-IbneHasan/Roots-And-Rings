import type { APIRoute } from 'astro';

const API = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:4000';

export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  await fetch(`${API}/api/auth/forgot-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: form.get('email') }),
  });
  // Always behave the same (enumeration-safe).
  return redirect('/account/reset-password?sent=1');
};
