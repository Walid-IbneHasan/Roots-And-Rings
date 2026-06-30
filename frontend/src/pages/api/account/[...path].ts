import type { APIRoute } from 'astro';
import { SESSION_COOKIE } from '../../../lib/auth';

const API = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:4000';

const handler: APIRoute = async ({ request, params, cookies }) => {
  const token = cookies.get(SESSION_COOKIE)?.value;
  if (!token) return new Response(JSON.stringify({ message: 'Authentication required' }), { status: 401, headers: { 'content-type': 'application/json' } });
  const path = params.path ? `/${params.path}` : '';
  const search = new URL(request.url).search;
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  const ct = request.headers.get('content-type');
  if (ct) headers['content-type'] = ct;
  const init: RequestInit = { method: request.method, headers };
  if (request.method !== 'GET' && request.method !== 'HEAD') init.body = await request.arrayBuffer();
  const res = await fetch(`${API}/api/account${path}${search}`, init);
  return new Response(await res.text(), { status: res.status, headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' } });
};

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;
