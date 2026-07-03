import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { Customer } from '../models/Customer.js';
import { config } from '../config.js';

const COOKIE = 'aliraah_session';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function hashPassword(pw) {
  return bcrypt.hash(pw, 12);
}
export async function verifyPassword(pw, hash) {
  return bcrypt.compare(pw, hash);
}

export function signToken(customer) {
  return jwt.sign({ sub: customer._id.toString() }, config.jwtSecret, { expiresIn: '7d' });
}

/** Set the session as an httpOnly cookie. Secure + SameSite=None in prod so it
 *  works across the site/api origins; Lax over http in dev. */
export function setAuthCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: config.isProd ? 'none' : 'lax',
    maxAge: MAX_AGE_MS,
    path: '/',
  });
}

export function clearAuthCookie(res) {
  res.clearCookie(COOKIE, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: config.isProd ? 'none' : 'lax',
    path: '/',
  });
}

/** Resolve the current customer from the session cookie, or null. */
export async function customerFromReq(req) {
  const token = req.cookies?.[COOKIE];
  if (!token) return null;
  try {
    const { sub } = jwt.verify(token, config.jwtSecret);
    const c = await Customer.findById(sub);
    // Unverified accounts never get a session — belt-and-braces check here too.
    if (!c || c.status !== 'active' || !c.verified) return null;
    return c;
  } catch {
    return null;
  }
}

/* ── Owner-approval access codes ──────────────────────────────────────
   On signup a 6-digit code is texted to the business owner, who forwards
   it to the customer. Only a matching code activates the account. */

export function generateVerifyCode() {
  return String(crypto.randomInt(100000, 1000000)); // 6 digits, crypto RNG
}

export function hashVerifyCode(code) {
  return crypto.createHash('sha256').update(`${config.jwtSecret}:${code}`).digest('hex');
}

export const VERIFY_CODE_TTL_MS = 24 * 60 * 60 * 1000; // owner may take a while to forward

/** Middleware: require a logged-in customer, attaches req.customer. */
export async function requireCustomer(req, res, next) {
  const c = await customerFromReq(req);
  if (!c) return res.status(401).json({ error: 'Not signed in' });
  req.customer = c;
  next();
}

/** Generate a unique AL-###### account number (retries on the rare collision). */
export async function generateAccountNumber() {
  for (let i = 0; i < 6; i++) {
    const n = Math.floor(100000 + Math.random() * 900000);
    const acct = `AL-${n}`;
    const exists = await Customer.exists({ accountNumber: acct });
    if (!exists) return acct;
  }
  // Extremely unlikely fallback.
  return `AL-${Date.now().toString().slice(-6)}`;
}
