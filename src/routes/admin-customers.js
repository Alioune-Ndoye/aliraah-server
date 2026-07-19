import { Router } from 'express';
import { z } from 'zod';
import { Customer } from '../models/Customer.js';
import { Booking } from '../models/Booking.js';
import { requireAdmin, adminAuthLimiter } from '../middleware/security.js';

export const adminCustomersRouter = Router();

// GET /api/admin/customers?q= — searchable list (admin).
adminCustomersRouter.get('/', adminAuthLimiter, requireAdmin, async (req, res, next) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const filter = q
      ? {
          $or: [
            { firstName: { $regex: q, $options: 'i' } },
            { lastName: { $regex: q, $options: 'i' } },
            { email: { $regex: q, $options: 'i' } },
            { accountNumber: { $regex: q, $options: 'i' } },
          ],
        }
      : {};
    const docs = await Customer.find(filter).sort({ createdAt: -1 }).limit(300).exec();
    res.json({ count: docs.length, customers: docs.map((d) => d.toPublic()) });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/customers/:id/approve — activate an account without the
// SMS access code. The owner's manual fallback for when texting is down:
// pending signups get approved with one click from the dashboard.
adminCustomersRouter.post('/:id/approve', adminAuthLimiter, requireAdmin, async (req, res, next) => {
  try {
    if (!/^[a-f0-9]{24}$/i.test(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const c = await Customer.findById(req.params.id);
    if (!c) return res.status(404).json({ error: 'Not found' });
    if (!c.verified) {
      c.verified = true;
      c.verifyCodeHash = '';
      c.verifyCodeExpires = undefined;
      await c.save();
    }
    res.json({ ok: true, customer: c.toPublic() });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/customers/:id — profile + that customer's bookings.
adminCustomersRouter.get('/:id', adminAuthLimiter, requireAdmin, async (req, res, next) => {
  try {
    if (!/^[a-f0-9]{24}$/i.test(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const c = await Customer.findById(req.params.id);
    if (!c) return res.status(404).json({ error: 'Not found' });
    const bookings = await Booking.find({ $or: [{ customerId: c._id }, { email: c.email }] })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean()
      .exec();
    res.json({ customer: c.toPublic(), bookings });
  } catch (err) {
    next(err);
  }
});

// Admin may edit profile + loyalty fields (never the password hash).
const editSchema = z.object({
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(40).optional(),
  street: z.string().trim().max(160).optional(),
  apt: z.string().trim().max(40).optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(16).optional(),
  zip: z.string().trim().max(16).optional(),
  accountType: z.enum(['residential', 'property_manager']).optional(),
  tier: z.enum(['standard', 'silver', 'gold']).optional(),
  discountRate: z.number().min(0).max(100).optional(),
  recurring: z.boolean().optional(),
  avatarUrl: z.string().trim().max(2048).optional(),
  status: z.enum(['active', 'suspended']).optional(),
  notes: z.string().trim().max(2000).optional(),
});

// PATCH /api/admin/customers/:id
adminCustomersRouter.patch('/:id', adminAuthLimiter, requireAdmin, async (req, res, next) => {
  try {
    if (!/^[a-f0-9]{24}$/i.test(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const parsed = editSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid update', details: parsed.error.flatten() });
    }
    const c = await Customer.findById(req.params.id);
    if (!c) return res.status(404).json({ error: 'Not found' });
    for (const [k, v] of Object.entries(parsed.data)) {
      if (v !== undefined) c[k] = v;
    }
    await c.save();
    res.json({ ok: true, customer: c.toPublic() });
  } catch (err) {
    next(err);
  }
});
