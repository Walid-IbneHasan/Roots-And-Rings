import type { FastifyInstance } from 'fastify';
import { hashPassword, verifyPassword } from '../../lib/password';
import { httpError } from '../../lib/errors';
import { signCustomerToken } from '../../lib/jwt';
import { issueOtp, verifyOtp } from './otp';
import { sendOtpEmail } from '../notifications/email';
import { requireCustomer } from './guards';
import { customerDto } from './dto';
import { registerBody, loginBody, verifyEmailBody, forgotBody, resetBody } from './schemas';
import { registerGoogleRoute } from './google';

const tightLimit = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

export default async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/register', tightLimit, async (request, reply) => {
    const { name, email, password } = registerBody.parse(request.body);
    const lower = email.toLowerCase();
    if (await app.prisma.customer.findUnique({ where: { email: lower } })) {
      throw httpError(409, 'An account with this email already exists');
    }
    const customer = await app.prisma.customer.create({
      data: { name, email: lower, passwordHash: await hashPassword(password) },
    });
    const code = await issueOtp(app.prisma, customer.id, 'EMAIL_VERIFY');
    await sendOtpEmail(customer.email, 'EMAIL_VERIFY', code);
    return reply.status(201).send({ token: signCustomerToken(customer), customer: customerDto(customer) });
  });

  app.post('/api/auth/login', tightLimit, async (request) => {
    const { email, password } = loginBody.parse(request.body);
    const customer = await app.prisma.customer.findUnique({ where: { email: email.toLowerCase() } });
    if (!customer || !customer.passwordHash || !customer.isActive) throw httpError(401, 'Invalid email or password');
    if (!(await verifyPassword(password, customer.passwordHash))) throw httpError(401, 'Invalid email or password');
    return { token: signCustomerToken(customer), customer: customerDto(customer) };
  });

  app.get('/api/auth/me', { preHandler: requireCustomer }, async (request) => {
    return { customer: customerDto(request.customer!) };
  });

  app.post('/api/auth/verify-email', { preHandler: requireCustomer }, async (request) => {
    const { code } = verifyEmailBody.parse(request.body);
    await verifyOtp(app.prisma, request.customer!.id, 'EMAIL_VERIFY', code);
    const updated = await app.prisma.customer.update({
      where: { id: request.customer!.id },
      data: { emailVerifiedAt: new Date() },
    });
    return { customer: customerDto(updated) };
  });

  app.post('/api/auth/forgot-password', tightLimit, async (request) => {
    const { email } = forgotBody.parse(request.body);
    const customer = await app.prisma.customer.findUnique({ where: { email: email.toLowerCase() } });
    if (customer && customer.isActive) {
      const code = await issueOtp(app.prisma, customer.id, 'PASSWORD_RESET');
      await sendOtpEmail(customer.email, 'PASSWORD_RESET', code);
    }
    return { ok: true }; // enumeration-safe: always 200
  });

  app.post('/api/auth/reset-password', tightLimit, async (request) => {
    const { email, code, newPassword } = resetBody.parse(request.body);
    const customer = await app.prisma.customer.findUnique({ where: { email: email.toLowerCase() } });
    if (!customer) throw httpError(400, 'Code is invalid or has expired');
    await verifyOtp(app.prisma, customer.id, 'PASSWORD_RESET', code);
    await app.prisma.customer.update({ where: { id: customer.id }, data: { passwordHash: await hashPassword(newPassword) } });
    return { ok: true };
  });
  registerGoogleRoute(app);
}
