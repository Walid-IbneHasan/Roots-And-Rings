import type { FastifyInstance } from 'fastify';

export const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@rootsandrings.example';
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'ChangeMe123!';

export function cookieHeader(res: { cookies: { name: string; value: string }[] }): string {
  return res.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

export async function loginAdmin(app: FastifyInstance, email = ADMIN_EMAIL, password = ADMIN_PASSWORD): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/admin/login',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({ email, password }).toString(),
  });
  return cookieHeader(res);
}

/** Extract a fresh CSRF token from any authed admin page under the given session cookie. */
export async function csrfFrom(app: FastifyInstance, url: string, cookie: string): Promise<string> {
  const res = await app.inject({ method: 'GET', url, headers: { cookie } });
  const m = res.body.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : '';
}

export async function formPost(
  app: FastifyInstance,
  url: string,
  cookie: string,
  token: string,
  fields: Record<string, string>,
) {
  return app.inject({
    method: 'POST',
    url,
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({ ...fields, _csrf: token }).toString(),
  });
}
