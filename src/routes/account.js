import { Router } from 'express';
import { z } from 'zod';
import { Booking } from '../models/Booking.js';
import { requireCustomer, hashPassword, verifyPassword } from '../lib/auth.js';

export const accountRouter = Router();

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
