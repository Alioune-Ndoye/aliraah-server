import { Router } from 'express';
import { z } from 'zod';
import { Booking } from '../models/Booking.js';
import { Property } from '../models/Property.js';
import { requireCustomer, hashPassword, verifyPassword } from '../lib/auth.js';

export const accountRouter = Router();

/* ── Properties (Property-Manager dashboard) ─────────────────────────
   All routes are scoped to the logged-in customer — a PM can only ever
   see or touch their own portfolio. */

const propertySchema = z.object({
  label: z.string().trim().max(120).optional().default(''),
  street: z.string().trim().min(1).max(160),
  apt: z.string().trim().max(40).optional().default(''),
  city: z.string().trim().max(80).optional().default(''),
  state: z.string().trim().max(16).optional().default(''),
  zip: z.string().trim().max(16).optional().default(''),
  bedrooms: z.string().trim().max(40).optional().default(''),
  bathrooms: z.string().trim().max(40).optional().default(''),
  size: z.string().trim().max(40).optional().default(''),
  access: z.string().trim().max(80).optional().default(''),
  notes: z.string().trim().max(2000).optional().default(''),
});

const MAX_PROPERTIES = 200;

// GET /api/account/properties — my portfolio (active first).
accountRouter.get('/properties', requireCustomer, async (req, res, next) => {
  try {
    const docs = await Property.find({ customerId: req.customer._id })
      .sort({ archived: 1, createdAt: 1 })
      .limit(MAX_PROPERTIES)
      .exec();
    res.json({ properties: docs.map((d) => d.toPublic()) });
  } catch (err) {
    next(err);
  }
});

// POST /api/account/properties — add a property.
accountRouter.post('/properties', requireCustomer, async (req, res, next) => {
  try {
    const parsed = propertySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid property details' });
    const count = await Property.countDocuments({ customerId: req.customer._id });
    if (count >= MAX_PROPERTIES) return res.status(400).json({ error: 'Property limit reached' });
    const doc = await Property.create({ ...parsed.data, customerId: req.customer._id });
    res.status(201).json({ ok: true, property: doc.toPublic() });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/account/properties/:id — edit or archive/unarchive (owner only).
accountRouter.patch('/properties/:id', requireCustomer, async (req, res, next) => {
  try {
    if (!/^[a-f0-9]{24}$/i.test(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const parsed = propertySchema.partial().extend({ archived: z.boolean().optional() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid property details' });
    const doc = await Property.findOneAndUpdate(
      { _id: req.params.id, customerId: req.customer._id }, // ownership enforced in the query
      parsed.data,
      { new: true, runValidators: true }
    );
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true, property: doc.toPublic() });
  } catch (err) {
    next(err);
  }
});

// GET /api/account/bookings — this customer's bookings (linked by id OR email,
// so bookings placed before they registered still appear in their history).
accountRouter.get('/bookings', requireCustomer, async (req, res, next) => {
  try {
    const c = req.customer;
    const docs = await Booking.find({
      $or: [{ customerId: c._id }, { email: c.email }],
    })
      .sort({ createdAt: -1 })
      .limit(200)
      // Customer-visible crew info: cleaner's first name only.
      .populate('cleanerId', 'firstName')
      .lean()
      .exec();
    res.json({ bookings: docs });
  } catch (err) {
    next(err);
  }
});

// Customers may edit contact/address + change password — NOT tier/discount/status.
const profileSchema = z.object({
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(40).optional(),
  street: z.string().trim().max(160).optional(),
  apt: z.string().trim().max(40).optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(16).optional(),
  zip: z.string().trim().max(16).optional(),
  currentPassword: z.string().max(200).optional(),
  newPassword: z.string().min(8).max(200).optional(),
});

// PATCH /api/account/profile
accountRouter.patch('/profile', requireCustomer, async (req, res, next) => {
  try {
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid profile update', details: parsed.error.flatten() });
    }
    const c = req.customer;
    const { currentPassword, newPassword, ...fields } = parsed.data;

    for (const [k, v] of Object.entries(fields)) {
      if (v !== undefined) c[k] = v;
    }

    if (newPassword) {
      if (!currentPassword || !(await verifyPassword(currentPassword, c.passwordHash))) {
        return res.status(403).json({ error: 'Current password is incorrect.' });
      }
      c.passwordHash = await hashPassword(newPassword);
    }

    await c.save();
    res.json({ ok: true, customer: c.toPublic() });
  } catch (err) {
    next(err);
  }
});
