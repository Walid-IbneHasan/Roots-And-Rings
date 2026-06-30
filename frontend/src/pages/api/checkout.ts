import type { APIRoute } from 'astro';
import { SESSION_COOKIE } from '../../lib/auth';

const API = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:4000';

export const POST: APIRoute = async ({ request, cookies }) => {
  const body = await request.text();
  const token = cookies.get(SESSION_COOKIE)?.value;
  const res = await fetch(`${API}/api/checkout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body,
  });
  return new Response(await res.text(), { status: res.status, headers: { 'content-type': 'application/json' } });
};
