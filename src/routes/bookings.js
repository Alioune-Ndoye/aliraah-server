import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { Booking } from '../models/Booking.js';
import { Property } from '../models/Property.js';
import { config } from '../config.js';
import { writeLimiter, requireAdmin, adminAuthLimiter } from '../middleware/security.js';
import { customerFromReq } from '../lib/auth.js';
import { notifyOwner, bookingSms } from '../lib/notify.js';

export const bookingsRouter = Router();

const str = (max) => z.string().trim().max(max);

const createSchema = z.object({
  kind: z.enum(['booking', 'quote']).optional().default('booking'),
  firstName: str(80).min(1),
  lastName: str(80).optional().default(''),
  email: z.string().trim().email().max(160),
  phone: str(40).min(7),
  smsOptIn: z.boolean().optional().default(false),

  street: str(160).optional().default(''),
  apt: str(40).optional().default(''),
  city: str(80).optional().default(''),
  state: str(16).optional().default(''),
  zip: str(16).optional().default(''),

  size: str(40).optional().default(''),
  bedrooms: str(40).optional().default(''),
  bathrooms: str(40).optional().default(''),
  frequency: str(40).optional().default(''),
  extras: z.array(str(60)).max(40).optional().default([]),
  access: str(80).optional().default(''),
  notes: str(2000).optional().default(''),

  date: str(20).optional().default(''),
  time: str(20).optional().default(''),

  estimatedTotal: z.number().min(0).max(1_000_000).optional().default(0),
  estimatedHours: z.number().min(0).max(1000).optional().default(0),
  tip: z.number().min(0).max(100000).optional().default(0),
  promoCode: str(40).optional().default(''),
  // PM dashboard: which saved property this clean is for. Only honored when
  // the property belongs to the logged-in customer (checked below).
  propertyId: z.string().regex(/^[a-f0-9]{24}$/i).optional(),
});

function hashIp(ip) {
  const salt = config.adminToken || 'aalirah';
  return crypto.createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 32);
}

// POST /api/bookings — public booking/quote submission.
bookingsRouter.post('/', writeLimiter, async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid booking', details: parsed.error.flatten() });
    }
    // Link to the logged-in customer (derived server-side from the cookie).
    const customer = await customerFromReq(req);

    // Honor propertyId only if it belongs to this logged-in customer.
    const { propertyId, ...bookingData } = parsed.data;
    let verifiedPropertyId;
    if (propertyId && customer) {
      const owns = await Property.exists({ _id: propertyId, customerId: customer._id });
      if (owns) verifiedPropertyId = propertyId;
    }

    const doc = await Booking.create({
      ...bookingData,
      ...(customer ? { customerId: customer._id } : {}),
      ...(verifiedPropertyId ? { propertyId: verifiedPropertyId } : {}),
      ipHash: hashIp(req.ip || ''),
      userAgent: (req.get('user-agent') || '').slice(0, 256),
    });

    // Text the owner right away (carrier email-to-SMS gateway). Fire-and-forget
    // so a slow/failed alert never delays or breaks the customer's booking.
    notifyOwner(bookingSms(doc)).catch(() => {});

    res.status(201).json({ ok: true, id: doc._id.toString() });
  } catch (err) {
    next(err);
  }
});

// GET /api/bookings — admin list (newest first, optional ?status= filter).
bookingsRouter.get('/', adminAuthLimiter, requireAdmin, async (req, res, next) => {
  try {
    const filter = {};
    const status = z.enum(['new', 'contacted', 'scheduled', 'completed', 'cancelled']).safeParse(req.query.status);
    if (status.success) filter.status = status.data;

    const limit = Math.min(Number(req.query.limit) || 200, 500);
    const docs = await Booking.find(filter).sort({ createdAt: -1 }).limit(limit).lean().exec();
    res.json({ count: docs.length, bookings: docs });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/bookings/:id/status — admin pipeline update.
bookingsRouter.patch('/:id/status', adminAuthLimiter, requireAdmin, async (req, res, next) => {
  try {
    if (!/^[a-f0-9]{24}$/i.test(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const status = z
      .enum(['new', 'contacted', 'scheduled', 'completed', 'cancelled'])
      .safeParse(req.body?.status);
    if (!status.success) return res.status(400).json({ error: 'Invalid status' });

    const doc = await Booking.findByIdAndUpdate(req.params.id, { status: status.data }, { new: true });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true, status: doc.status });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/bookings/:id/meta — admin sets payment status and/or photos.
const metaSchema = z
  .object({
    paymentStatus: z.enum(['unpaid', 'paid', 'refunded']).optional(),
    photos: z
      .array(
        z.object({
          url: z.string().trim().url().max(2048).refine((u) => u.startsWith('https://'), 'https only'),
          kind: z.enum(['before', 'after']),
        })
      )
      .max(24)
      .optional(),
  })
  .strict();

bookingsRouter.patch('/:id/meta', adminAuthLimiter, requireAdmin, async (req, res, next) => {
  try {
    if (!/^[a-f0-9]{24}$/i.test(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const parsed = metaSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid booking meta' });

    const doc = await Booking.findByIdAndUpdate(req.params.id, parsed.data, { new: true, runValidators: true });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true, paymentStatus: doc.paymentStatus, photos: doc.photos });
  } catch (err) {
    next(err);
  }
});

// GET /api/bookings/export.csv — admin export for Excel/accounting.
bookingsRouter.get('/export.csv', adminAuthLimiter, requireAdmin, async (_req, res, next) => {
  try {
    const docs = await Booking.find().sort({ createdAt: -1 }).limit(5000).lean().exec();
    const cols = [
      'createdAt', 'status', 'kind', 'firstName', 'lastName', 'email', 'phone',
      'street', 'apt', 'city', 'state', 'zip', 'size', 'bedrooms', 'bathrooms',
      'frequency', 'extras', 'access', 'date', 'time', 'estimatedTotal', 'tip', 'promoCode', 'notes',
    ];
    const esc = (v) => {
      const s = Array.isArray(v) ? v.join('; ') : v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = docs.map((d) => cols.map((c) => esc(d[c])).join(','));
    const csv = [cols.join(','), ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="aliraah-bookings-${Date.now()}.csv"`);
    res.send(csv);
  } catch (err) {
    next(err);
  }
});
