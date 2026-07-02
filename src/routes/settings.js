import { Router } from 'express';
import { z } from 'zod';
import { Settings } from '../models/Settings.js';
import { requireAdmin, adminAuthLimiter } from '../middleware/security.js';

export const settingsRouter = Router();

// GET /api/settings — public feature flags (no PII, no internals).
settingsRouter.get('/', async (_req, res, next) => {
  try {
    const doc = await Settings.get();
    res.json({ settings: doc.toPublic() });
  } catch (err) {
    next(err);
  }
});

const patchSchema = z
  .object({
    showGuarantee: z.boolean().optional(),
    showSpecials: z.boolean().optional(),
  })
  .strict();

// PATCH /api/settings — admin-only toggle updates.
settingsRouter.patch('/', adminAuthLimiter, requireAdmin, async (req, res, next) => {
  try {
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid settings' });

    const doc = await Settings.get();
    Object.assign(doc, parsed.data);
    await doc.save();
    res.json({ ok: true, settings: doc.toPublic() });
  } catch (err) {
    next(err);
  }
});
