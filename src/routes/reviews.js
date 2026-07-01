import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { Review } from '../models/Review.js';
import { config } from '../config.js';
import { getGoogleReviews } from '../services/googleReviews.js';
import { writeLimiter, requireAdmin, adminAuthLimiter } from '../middleware/security.js';

export const reviewsRouter = Router();

/** Validation schema for an incoming review. Anything outside this is rejected. */
const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  role: z.string().trim().max(80).optional().default(''),
  rating: z.number().int().min(1).max(5),
  text: z.string().trim().max(2000).optional().default(''),
  // Only allow https URLs or data:video clips — no javascript:/other schemes.
  video: z
    .string()
    .trim()
    .max(2048)
    .refine((v) => v === '' || /^(https:\/\/|data:video\/)/i.test(v), 'Invalid video URL')
    .optional()
    .default(''),
  jobRef: z.string().trim().max(64).optional().default(''),
});

/** One-way hash of the IP (salted) so we can rate-limit/dedupe without storing PII. */
function hashIp(ip) {
  const salt = config.adminToken || 'aalirah';
  return crypto.createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 32);
}

// POST /api/reviews — submit a review (held for moderation unless AUTO_APPROVE).
reviewsRouter.post('/', writeLimiter, async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid review', details: parsed.error.flatten() });
    }
    const data = parsed.data;
    if (!data.text && !data.video) {
      return res.status(400).json({ error: 'Provide a written review, a video, or both.' });
    }

    const doc = await Review.create({
      ...data,
      status: config.autoApprove ? 'approved' : 'pending',
      ipHash: hashIp(req.ip || ''),
      userAgent: (req.get('user-agent') || '').slice(0, 256),
    });

    res.status(201).json({ ok: true, status: doc.status, review: doc.toPublic() });
  } catch (err) {
    next(err);
  }
});

// GET /api/reviews — public list of APPROVED reviews only.
reviewsRouter.get('/', async (_req, res, next) => {
  try {
    const docs = await Review.find({ status: 'approved' })
      .sort({ createdAt: -1 })
      .limit(50)
      .exec();
    res.json({ reviews: docs.map((d) => d.toPublic()) });
  } catch (err) {
    next(err);
  }
});

// GET /api/reviews/google — Google Business reviews (text/rating only).
// Returns [] until GOOGLE_API_KEY + GOOGLE_PLACE_ID are configured.
reviewsRouter.get('/google', async (_req, res, next) => {
  try {
    res.json({ reviews: await getGoogleReviews() });
  } catch (err) {
    next(err);
  }
});

// GET /api/reviews/pending — moderation queue (admin only).
reviewsRouter.get('/pending', adminAuthLimiter, requireAdmin, async (_req, res, next) => {
  try {
    const docs = await Review.find({ status: 'pending' }).sort({ createdAt: -1 }).limit(200).exec();
    res.json({ reviews: docs.map((d) => ({ ...d.toPublic(), jobRef: d.jobRef })) });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/reviews/:id/status — approve/reject (admin only).
reviewsRouter.patch('/:id/status', adminAuthLimiter, requireAdmin, async (req, res, next) => {
  try {
    const status = z.enum(['approved', 'rejected']).safeParse(req.body?.status);
    if (!status.success) return res.status(400).json({ error: 'status must be approved or rejected' });
    if (!/^[a-f0-9]{24}$/i.test(req.params.id)) return res.status(400).json({ error: 'Invalid id' });

    const doc = await Review.findByIdAndUpdate(req.params.id, { status: status.data }, { new: true });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true, review: doc.toPublic() });
  } catch (err) {
    next(err);
  }
});
