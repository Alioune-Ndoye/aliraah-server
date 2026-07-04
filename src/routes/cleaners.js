import { Router } from 'express';
import { z } from 'zod';
import { Cleaner } from '../models/Cleaner.js';
import { Booking } from '../models/Booking.js';
import { requireAdmin, adminAuthLimiter } from '../middleware/security.js';
import { notifyOwner, sendSms } from '../lib/notify.js';

/* ── Admin: manage cleaners + assign jobs ─────────────────────────── */

export const adminCleanersRouter = Router();

const cleanerSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().max(80).optional().default(''),
  phone: z.string().trim().min(7).max(40),
  email: z.string().trim().email().max(160).optional().or(z.literal('')).default(''),
  notes: z.string().trim().max(2000).optional().default(''),
});

// GET /api/admin/cleaners
adminCleanersRouter.get('/', adminAuthLimiter, requireAdmin, async (_req, res, next) => {
  try {
    const docs = await Cleaner.find().sort({ createdAt: -1 }).limit(200).exec();
    res.json({ cleaners: docs.map((d) => d.toAdmin()) });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/cleaners — add a cleaner.
adminCleanersRouter.post('/', adminAuthLimiter, requireAdmin, async (req, res, next) => {
  try {
    const parsed = cleanerSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid cleaner details' });
    const doc = await Cleaner.create({ ...parsed.data, token: Cleaner.newToken() });
    res.status(201).json({ ok: true, cleaner: doc.toAdmin() });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/admin/cleaners/:id — edit / deactivate.
adminCleanersRouter.patch('/:id', adminAuthLimiter, requireAdmin, async (req, res, next) => {
  try {
    if (!/^[a-f0-9]{24}$/i.test(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const parsed = cleanerSchema.partial().extend({ status: z.enum(['active', 'inactive']).optional() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid cleaner details' });
    const doc = await Cleaner.findByIdAndUpdate(req.params.id, parsed.data, { new: true, runValidators: true });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true, cleaner: doc.toAdmin() });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/cleaners/assign/:bookingId — offer a job to a cleaner (texts them).
adminCleanersRouter.post('/assign/:bookingId', adminAuthLimiter, requireAdmin, async (req, res, next) => {
  try {
    if (!/^[a-f0-9]{24}$/i.test(req.params.bookingId)) return res.status(400).json({ error: 'Invalid booking id' });
    const cleanerId = z.string().regex(/^[a-f0-9]{24}$/i).safeParse(req.body?.cleanerId);
    if (!cleanerId.success) return res.status(400).json({ error: 'Invalid cleaner id' });

    const [booking, cleaner] = await Promise.all([
      Booking.findById(req.params.bookingId),
      Cleaner.findById(cleanerId.data),
    ]);
    if (!booking || !cleaner) return res.status(404).json({ error: 'Not found' });
    if (cleaner.status !== 'active') return res.status(400).json({ error: 'Cleaner is inactive' });

    booking.cleanerId = cleaner._id;
    booking.dispatch = 'offered';
    await booking.save();

    // Job-offer text. No URL (unverified TextBelt keys reject links) — the
    // cleaner opens their bookmarked crew page to respond.
    const when = [booking.date, booking.time].filter(Boolean).join(' ');
    const place = [booking.city, booking.zip].filter(Boolean).join(' ');
    sendSms(
      cleaner.phone,
      `Aliraah job offer: ${when} — ${[booking.bedrooms, booking.bathrooms].filter(Boolean).join('/')} in ${place}. Open your crew page to accept or decline.`
    ).catch(() => {});

    res.json({ ok: true, dispatch: booking.dispatch });
  } catch (err) {
    next(err);
  }
});

/* ── Crew: token-keyed job page (no password) ─────────────────────── */

export const crewRouter = Router();

/** Resolve an active cleaner from the URL token, or 404 (indistinguishable). */
async function cleanerByToken(req, res) {
  const token = String(req.params.token || '');
  if (!/^[a-f0-9]{32}$/.test(token)) {
    res.status(404).json({ error: 'Not found' });
    return null;
  }
  const cleaner = await Cleaner.findOne({ token, status: 'active' });
  if (!cleaner) {
    res.status(404).json({ error: 'Not found' });
    return null;
  }
  return cleaner;
}

/** Job shape shown to the cleaner: where/when/what — NOT the customer's email
 *  or the price. Address is needed to do the job; contact goes through the owner. */
function jobForCrew(b) {
  return {
    id: b._id.toString(),
    date: b.date,
    time: b.time,
    firstName: b.firstName,
    street: b.street,
    apt: b.apt,
    city: b.city,
    zip: b.zip,
    size: b.size,
    bedrooms: b.bedrooms,
    bathrooms: b.bathrooms,
    frequency: b.frequency,
    extras: b.extras,
    access: b.access,
    notes: b.notes,
    dispatch: b.dispatch,
  };
}

// GET /api/crew/:token — cleaner + their jobs.
crewRouter.get('/:token', async (req, res, next) => {
  try {
    const cleaner = await cleanerByToken(req, res);
    if (!cleaner) return;
    const jobs = await Booking.find({
      cleanerId: cleaner._id,
      dispatch: { $in: ['offered', 'accepted', 'on_the_way', 'in_progress'] },
    })
      .sort({ date: 1, time: 1 })
      .limit(50)
      .exec();
    res.json({ cleaner: cleaner.toCrew(), jobs: jobs.map(jobForCrew) });
  } catch (err) {
    next(err);
  }
});

// Allowed transitions the CLEANER may make.
const CREW_MOVES = {
  accept: { from: ['offered'], to: 'accepted' },
  decline: { from: ['offered'], to: 'declined' },
  on_the_way: { from: ['accepted'], to: 'on_the_way' },
  start: { from: ['on_the_way', 'accepted'], to: 'in_progress' },
  done: { from: ['in_progress', 'on_the_way'], to: 'done' },
};

// POST /api/crew/:token/jobs/:id — accept / decline / on_the_way / start / done.
crewRouter.post('/:token/jobs/:id', async (req, res, next) => {
  try {
    const cleaner = await cleanerByToken(req, res);
    if (!cleaner) return;
    if (!/^[a-f0-9]{24}$/i.test(req.params.id)) return res.status(400).json({ error: 'Invalid job id' });

    const action = z.enum(['accept', 'decline', 'on_the_way', 'start', 'done']).safeParse(req.body?.action);
    if (!action.success) return res.status(400).json({ error: 'Invalid action' });

    const booking = await Booking.findOne({ _id: req.params.id, cleanerId: cleaner._id });
    if (!booking) return res.status(404).json({ error: 'Not found' });

    const move = CREW_MOVES[action.data];
    if (!move.from.includes(booking.dispatch)) {
      return res.status(409).json({ error: `Job is ${booking.dispatch}` });
    }
    booking.dispatch = move.to;
    await booking.save();

    // Keep the owner in the loop on every move.
    const name = `${cleaner.firstName} ${cleaner.lastName}`.trim();
    const when = [booking.date, booking.time].filter(Boolean).join(' ');
    const labels = {
      accepted: 'ACCEPTED',
      declined: 'DECLINED',
      on_the_way: 'is ON THE WAY to',
      in_progress: 'STARTED',
      done: 'FINISHED',
    };
    notifyOwner(`Aliraah crew: ${name} ${labels[booking.dispatch]} the ${when} job (${booking.firstName}, ${booking.city}).`).catch(() => {});

    res.json({ ok: true, dispatch: booking.dispatch });
  } catch (err) {
    next(err);
  }
});
