import { Router } from 'express';
import { Booking } from '../models/Booking.js';

export const statsRouter = Router();

// GET /api/stats — public vanity metrics for the homepage.
// `bookings` grows by 1 every time a customer books through the site.
statsRouter.get('/', async (_req, res, next) => {
  try {
    const bookings = await Booking.countDocuments({});
    res.json({ bookings });
  } catch (err) {
    next(err);
  }
});
