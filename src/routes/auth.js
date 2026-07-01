import { Router } from 'express';
import { z } from 'zod';
import { Customer } from '../models/Customer.js';
import {
  hashPassword,
  verifyPassword,
  signToken,
  setAuthCookie,
  clearAuthCookie,
  customerFromReq,
  generateAccountNumber,
} from '../lib/auth.js';
import { authLimiter } from '../middleware/security.js';

export const authRouter = Router();

const signupSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().max(80).optional().default(''),
  email: z.string().trim().email().max(160),
  password: z.string().min(8).max(200),
  phone: z.string().trim().max(40).optional().default(''),
  street: z.string().trim().max(160).optional().default(''),
  apt: z.string().trim().max(40).optional().default(''),
  city: z.string().trim().max(80).optional().default(''),
  state: z.string().trim().max(16).optional().default(''),
  zip: z.string().trim().max(16).optional().default(''),
});

// POST /api/auth/signup
authRouter.post('/signup', authLimiter, async (req, res, next) => {
  try {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid sign-up details', details: parsed.error.flatten() });
    }
    const { password, ...data } = parsed.data;
    const email = data.email.toLowerCase();

    if (await Customer.exists({ email })) {
      return res.status(409).json({ error: 'An account with that email already exists.' });
    }

    const customer = await Customer.create({
      ...data,
      email,
      passwordHash: await hashPassword(password),
      accountNumber: await generateAccountNumber(),
      lastLoginAt: new Date(),
    });

    setAuthCookie(res, signToken(customer));
    res.status(201).json({ ok: true, customer: customer.toPublic() });
  } catch (err) {
    next(err);
  }
});

const loginSchema = z.object({
  email: z.string().trim().email().max(160),
  password: z.string().min(1).max(200),
});

// POST /api/auth/login
authRouter.post('/login', authLimiter, async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    // Generic message everywhere to avoid user enumeration.
    const fail = () => res.status(401).json({ error: 'Invalid email or password.' });
    if (!parsed.success) return fail();

    const customer = await Customer.findOne({ email: parsed.data.email.toLowerCase() });
    if (!customer || customer.status !== 'active') return fail();
    if (!(await verifyPassword(parsed.data.password, customer.passwordHash))) return fail();

    customer.lastLoginAt = new Date();
    await customer.save();

    setAuthCookie(res, signToken(customer));
    res.json({ ok: true, customer: customer.toPublic() });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/logout
authRouter.post('/logout', (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

// GET /api/auth/me — current customer or null.
authRouter.get('/me', async (req, res, next) => {
  try {
    const customer = await customerFromReq(req);
    res.json({ customer: customer ? customer.toPublic() : null });
  } catch (err) {
    next(err);
  }
});
