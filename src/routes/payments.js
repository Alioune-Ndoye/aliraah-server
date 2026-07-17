import { Router } from 'express';
import { Booking } from '../models/Booking.js';
import { requireCustomer } from '../lib/auth.js';
import { config } from '../config.js';

export const paymentsRouter = Router();

/**
 * POST /api/payments/checkout/:bookingId
 *
 * Customer-initiated payment for one of THEIR bookings (ownership enforced
 * via the session — a customer can never pay/see someone else's booking).
 *
 * Scaffolded ahead of Stripe: everything up to the charge is real (auth,
 * ownership, amount, unpaid check). Once STRIPE_SECRET_KEY is set, drop the
 * Stripe Checkout session creation into the marked block and the portal's
 * "Pay" button goes live with zero frontend changes — it already follows
 * a returned `url` and shows `error` messages otherwise.
 */
paymentsRouter.post('/checkout/:bookingId', requireCustomer, async (req, res, next) => {
  try {
    if (!/^[a-f0-9]{24}$/i.test(req.params.bookingId)) return res.status(400).json({ error: 'Invalid booking id' });

    const booking = await Booking.findOne({ _id: req.params.bookingId, customerId: req.customer._id });
    if (!booking) return res.status(404).json({ error: 'Not found' });
    if (booking.paymentStatus === 'paid') return res.status(400).json({ error: 'This cleaning is already paid.' });
    if (!booking.estimatedTotal || booking.estimatedTotal <= 0) {
      return res.status(400).json({ error: 'Nothing to charge on this booking yet.' });
    }

    if (!config.stripe.secretKey) {
      // Payments not connected yet — honest, friendly signal to the portal.
      return res.status(503).json({
        error: 'Online payment is coming soon. For now, please pay your cleaner directly or call us.',
        pending: true,
      });
    }

    /* ── STRIPE GOES HERE (when keys are configured) ──────────────────
       const stripe = new Stripe(config.stripe.secretKey);
       const session = await stripe.checkout.sessions.create({
         mode: 'payment',
         line_items: [{
           price_data: {
             currency: 'usd',
             unit_amount: Math.round(booking.estimatedTotal * 100),
             product_data: { name: `Aliraah cleaning — ${booking.date || 'scheduled'}` },
           },
           quantity: 1,
         }],
         metadata: { bookingId: booking._id.toString() },
         success_url: 'https://aliraah.com/account?paid=1',
         cancel_url: 'https://aliraah.com/account',
       });
       return res.json({ ok: true, url: session.url });
       (+ a webhook route flips paymentStatus to 'paid' on completion)
    ──────────────────────────────────────────────────────────────────── */
    res.status(503).json({ error: 'Payments are being set up.', pending: true });
  } catch (err) {
    next(err);
  }
});
