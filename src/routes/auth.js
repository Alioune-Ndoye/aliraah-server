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
  generateVerifyCode,
  hashVerifyCode,
  VERIFY_CODE_TTL_MS,
} from '../lib/auth.js';
import { authLimiter } from '../middleware/security.js';
import { notifyOwner } from '../lib/notify.js';

/** Text the access code to the business owner (who forwards it to the customer). */
async function sendCodeToOwner(customer, code) {
  const name = `${customer.firstName} ${customer.lastName}`.trim();
  await notifyOwner(
    `Aliraah account request\nName: ${name}\nAcct: ${customer.accountNumber}\nAccess code: ${code}\nForward this code to the customer to approve their account.`
  );
}

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

    // Owner-approval gate: the account starts UNVERIFIED and gets no session.
    // The access code goes to the business owner, who forwards it on.
    const code = generateVerifyCode();
    const customer = await Customer.create({
      ...data,
      email,
      passwordHash: await hashPassword(password),
      accountNumber: await generateAccountNumber(),
      verified: false,
      verifyCodeHash: hashVerifyCode(code),
      verifyCodeExpires: new Date(Date.now() + VERIFY_CODE_TTL_MS),
    });

    sendCodeToOwner(customer, code).catch(() => {});

    res.status(201).json({
      ok: true,
      pending: true,
      message: 'Account created. Aliraah will send you your access code shortly.',
      // Exposed ONLY under the test runner so the smoke suite can verify.
      ...(process.env.NODE_ENV === 'test' ? { devCode: code } : {}),
    });
  } catch (err) {
    next(err);
  }
});

const verifySchema = z.object({
  email: z.string().trim().email().max(160),
  code: z.string().trim().regex(/^\d{6}$/),
});

// POST /api/auth/verify — customer enters the code the owner forwarded them.
authRouter.post('/verify', authLimiter, async (req, res, next) => {
  try {
    const parsed = verifySchema.safeParse(req.body);
    const fail = () => res.status(401).json({ error: 'Invalid or expired code.' });
    if (!parsed.success) return fail();

    const customer = await Customer.findOne({ email: parsed.data.email.toLowerCase() });
    if (!customer || customer.status !== 'active') return fail();
    if (customer.verified) {
      // Already approved — just tell them to sign in (no session from this route).
      return res.json({ ok: true, verified: true });
    }
    if (!customer.verifyCodeHash || !customer.verifyCodeExpires || customer.verifyCodeExpires < new Date()) {
      return fail();
    }
    if (hashVerifyCode(parsed.data.code) !== customer.verifyCodeHash) return fail();

    customer.verified = true;
    customer.verifyCodeHash = '';
    customer.verifyCodeExpires = undefined;
    customer.lastLoginAt = new Date();
    await customer.save();

    setAuthCookie(res, signToken(customer));
    res.json({ ok: true, verified: true, customer: customer.toPublic() });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/resend-code — regenerate and re-text the owner.
authRouter.post('/resend-code', authLimiter, async (req, res, next) => {
  try {
    const email = z.string().trim().email().max(160).safeParse(req.body?.email);
    // Always the same generic answer — no user enumeration.
    const done = () => res.json({ ok: true, message: 'If that account exists, a new code is on its way.' });
    if (!email.success) return done();

    const customer = await Customer.findOne({ email: email.data.toLowerCase() });
    if (!customer || customer.verified || customer.status !== 'active') return done();

    const code = generateVerifyCode();
    customer.verifyCodeHash = hashVerifyCode(code);
    customer.verifyCodeExpires = new Date(Date.now() + VERIFY_CODE_TTL_MS);
    await customer.save();
    sendCodeToOwner(customer, code).catch(() => {});
    done();
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

    // Correct password but not yet approved → send them to the code screen.
    if (!customer.verified) {
      return res.status(403).json({ error: 'Account pending approval.', pending: true });
    }

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
