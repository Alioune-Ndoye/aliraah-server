import express from 'express';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import {
  corsMiddleware,
  helmetMiddleware,
  sanitizeMiddleware,
  hppMiddleware,
  baseLimiter,
} from './middleware/security.js';
import { reviewsRouter } from './routes/reviews.js';
import { bookingsRouter } from './routes/bookings.js';
import { statsRouter } from './routes/stats.js';
import { authRouter } from './routes/auth.js';
import { accountRouter } from './routes/account.js';
import { adminCustomersRouter } from './routes/admin-customers.js';

/** Builds the Express app (separated from server bootstrap so tests can import it). */
export function createApp() {
  const app = express();

  // Correct client IP behind a proxy/load balancer (needed for rate limiting).
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmetMiddleware);
  app.use(corsMiddleware);
  app.use(express.json({ limit: config.bodyLimit }));
  app.use(cookieParser());
  app.use(sanitizeMiddleware);
  app.use(hppMiddleware);
  app.use(baseLimiter);
  if (!config.isProd) app.use(morgan('dev'));

  app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));
  app.use('/api/auth', authRouter);
  app.use('/api/account', accountRouter);
  app.use('/api/reviews', reviewsRouter);
  app.use('/api/bookings', bookingsRouter);
  app.use('/api/stats', statsRouter);
  app.use('/api/admin/customers', adminCustomersRouter);

  // 404
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

  // Central error handler — never leak stack traces or internals to clients.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err?.message === 'Not allowed by CORS') {
      return res.status(403).json({ error: 'Origin not allowed' });
    }
    console.error('[error]', err?.message || err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
