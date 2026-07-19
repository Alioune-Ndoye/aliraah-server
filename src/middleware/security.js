import helmet from 'helmet';
import cors from 'cors';
import hpp from 'hpp';
import mongoSanitize from 'express-mongo-sanitize';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';

/** Strict CORS: only browser origins on the allowlist may call the API.
 *  credentials:true is required so the httpOnly session cookie is sent/received. */
export const corsMiddleware = cors({
  origin(origin, cb) {
    // Allow same-origin / server-to-server / curl (no Origin header).
    if (!origin) return cb(null, true);
    if (config.corsOrigins.includes(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH'],
  maxAge: 86400,
});

/** Security headers (CSP, HSTS, no-sniff, frameguard, etc.). */
export const helmetMiddleware = helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
});

/** Strip `$` / `.` operators from user input — blocks NoSQL injection. */
export const sanitizeMiddleware = mongoSanitize();

/** Guard against HTTP parameter pollution. */
export const hppMiddleware = hpp();

/** Baseline limiter for every request. */
export const baseLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

/** Limiter for signup/login — slows credential stuffing & brute force.
 *  AUTH_LIMIT_MAX is only overridden by the test runner. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.AUTH_LIMIT_MAX) || 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again later.' },
});

/** Tight limiter for public submissions (reviews + bookings share it) —
 *  discourages spam/abuse. WRITE_LIMIT_MAX is only overridden by the test
 *  runner, which fires many submissions from one IP. */
export const writeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.WRITE_LIMIT_MAX) || 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many submissions. Please try again later.' },
});

/**
 * Brute-force guard for admin auth. Only FAILED attempts count
 * (skipSuccessfulRequests), so the owner's valid requests are never throttled,
 * but a guesser hammering the short passcode gets locked out fast.
 */
export const adminAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again later.' },
});

/** Bearer-token gate for moderation/admin routes. Uses constant-time compare. */
export function requireAdmin(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!config.adminToken || !timingSafeEqual(token, config.adminToken)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
