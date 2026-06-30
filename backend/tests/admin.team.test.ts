import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { loginAdmin, csrfFrom, formPost, ADMIN_EMAIL, ADMIN_PASSWORD } from './helpers';

let app: FastifyInstance;
let adminCookie: string;
const STAFF_EMAIL = 'staff-zz@rootsandrings.example';
const STAFF_PASSWORD = 'StaffPass123!';

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  adminCookie = await loginAdmin(app);
});
afterAll(async () => {
  await app.prisma.user.deleteMany({ where: { email: STAFF_EMAIL } });
  await app.close();
});

describe('admin team management + boundary', () => {
  it('admin can add a staff user', async () => {
    const token = await csrfFrom(app, '/admin/team', adminCookie);
    const res = await formPost(app, '/admin/team', adminCookie, token, {
      name: 'Test Staff',
      email: STAFF_EMAIL,
      role: 'STAFF',
      password: STAFF_PASSWORD,
    });
    expect(res.statusCode).toBe(302);
    const staff = await app.prisma.user.findUnique({ where: { email: STAFF_EMAIL } });
    expect(staff?.role).toBe('STAFF');
  });

  it('staff can view team but cannot add users (403)', async () => {
    const staffCookie = await loginAdmin(app, STAFF_EMAIL, STAFF_PASSWORD);
    const view = await app.inject({ method: 'GET', url: '/admin/team', headers: { cookie: staffCookie } });
    expect(view.statusCode).toBe(200);

    const token = await csrfFrom(app, '/admin/team', staffCookie);
    const res = await formPost(app, '/admin/team', staffCookie, token, {
      name: 'Sneaky',
      email: 'sneaky-zz@x.com',
      role: 'ADMIN',
      password: 'whatever123',
    });
    expect(res.statusCode).toBe(403);
    expect(await app.prisma.user.findUnique({ where: { email: 'sneaky-zz@x.com' } })).toBeNull();
  });

  it('blocks deleting the last admin', async () => {
    const admin = await app.prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
    const token = await csrfFrom(app, '/admin/team', adminCookie);
    const res = await formPost(app, `/admin/team/${admin!.id}/delete`, adminCookie, token, {});
    expect(res.statusCode).toBe(400);
    expect(await app.prisma.user.findUnique({ where: { email: ADMIN_EMAIL } })).toBeTruthy();
  });

  it('admin can delete the staff user', async () => {
    const staff = await app.prisma.user.findUnique({ where: { email: STAFF_EMAIL } });
    const token = await csrfFrom(app, '/admin/team', adminCookie);
    const res = await formPost(app, `/admin/team/${staff!.id}/delete`, adminCookie, token, {});
    expect(res.statusCode).toBe(302);
    expect(await app.prisma.user.findUnique({ where: { email: STAFF_EMAIL } })).toBeNull();
  });
});
