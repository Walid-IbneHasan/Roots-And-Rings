import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { signCustomerToken } from '../src/lib/jwt';
import { hashPassword } from '../src/lib/password';

let app: FastifyInstance;
let token = '';

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  const c = await app.prisma.customer.create({ data: { email: 'addr-zz@test.com', name: 'Addr', passwordHash: await hashPassword('x12345678') } });
  token = signCustomerToken(c);
});

afterAll(async () => {
  await app.prisma.customer.deleteMany({ where: { email: 'addr-zz@test.com' } });
  await app.close();
});

const h = () => ({ authorization: `Bearer ${token}` });
const body = { name: 'Addr', phone: '0', line1: '1 Rd', city: 'Dhaka', district: 'Dhaka', postalCode: '1200' };

describe('addresses', () => {
  it('creates, lists, sets default, and deletes', async () => {
    const a = await app.inject({ method: 'POST', url: '/api/account/addresses', headers: h(), payload: { ...body, isDefault: true } });
    expect(a.statusCode).toBe(201);
    const id1 = a.json().id;

    const b = await app.inject({ method: 'POST', url: '/api/account/addresses', headers: h(), payload: { ...body, line1: '2 Rd' } });
    const id2 = b.json().id;

    const list = await app.inject({ method: 'GET', url: '/api/account/addresses', headers: h() });
    expect(list.json().length).toBe(2);

    const setDef = await app.inject({ method: 'POST', url: `/api/account/addresses/${id2}/default`, headers: h() });
    expect(setDef.statusCode).toBe(200);
    const after = await app.inject({ method: 'GET', url: '/api/account/addresses', headers: h() });
    const defaults = after.json().filter((x: any) => x.isDefault);
    expect(defaults.length).toBe(1);
    expect(defaults[0].id).toBe(id2);

    const del = await app.inject({ method: 'DELETE', url: `/api/account/addresses/${id1}`, headers: h() });
    expect(del.statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/account/addresses', headers: h() })).json().length).toBe(1);
  });
});
