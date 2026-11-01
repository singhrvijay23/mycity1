import Fastify, { FastifyReply, FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { ZodError } from 'zod';
import { HttpError } from './lib/errors.js';
import authRoutes from './routes/auth.js';
import publicRoutes from './routes/public.js';
import customerRoutes from './routes/customer.js';
import vendorRoutes from './routes/vendor.js';
import chatRoutes from './routes/chat.js';
import adminRoutes from './routes/admin.js';

export type Role = 'customer' | 'vendor' | 'admin';
declare module '@fastify/jwt' {
  interface FastifyJWT { payload: { sub: number; role: Role }; user: { sub: number; role: Role } }
}

export function requireRole(...roles: Role[]) {
  return async (req: FastifyRequest, _rep: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      throw new HttpError(401, 'Login required', 'unauthorized');
    }
    if (roles.length && !roles.includes(req.user.role)) throw new HttpError(403, 'Not allowed for your role', 'forbidden');
  };
}

export async function buildApp() {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });
  await app.register(cors, { origin: true });
  await app.register(jwt, { secret: process.env.JWT_SECRET ?? 'dev-secret-change-me', sign: { expiresIn: '30d' } });

  app.setErrorHandler((err, _req, rep) => {
    if (err instanceof HttpError) return rep.status(err.status).send({ error: err.code ?? 'error', message: err.message });
    if (err instanceof ZodError) return rep.status(400).send({ error: 'validation', message: 'Invalid input', issues: err.issues });
    app.log.error(err);
    return rep.status(500).send({ error: 'internal', message: 'Something went wrong' });
  });

  app.get('/health', async () => ({ ok: true }));
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(publicRoutes);
  await app.register(customerRoutes);
  await app.register(vendorRoutes, { prefix: '/vendor' });
  await app.register(chatRoutes);
  await app.register(adminRoutes, { prefix: '/admin' });
  return app;
}
