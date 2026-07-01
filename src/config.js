import 'dotenv/config';

/**
 * Centralised, validated configuration.
 * Fails fast and loud if a required secret is missing so we never boot
 * a server that silently can't reach the database.
 */
function required(name) {
  const v = process.env[name];
  if (!v || !v.trim()) {
    console.error(
      `\n[config] Missing required env var: ${name}\n` +
        `Add it to server/.env (copy server/.env.example to get started).\n`
    );
    process.exit(1);
  }
  return v.trim();
}

const isProd = process.env.NODE_ENV === 'production';

export const config = {
  isProd,
  port: Number(process.env.PORT) || 4000,

  // Mongo connection string — never hard-coded, never committed.
  mongoUri: required('MONGODB_URI'),

  // Allowed browser origins for CORS (comma-separated). Defaults cover local dev.
  corsOrigins: (process.env.CORS_ORIGINS ||
    'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // Bearer token guarding moderation/admin endpoints.
  adminToken: process.env.ADMIN_TOKEN || '',

  // Secret that signs customer session JWTs (httpOnly cookie).
  jwtSecret: process.env.JWT_SECRET || '',

  // Auto-publish new reviews, or hold them for moderation (default: hold).
  autoApprove: process.env.AUTO_APPROVE === 'true',

  // Max JSON body size. Kept small — this API only takes structured text.
  bodyLimit: process.env.BODY_LIMIT || '64kb',

  // ── Google Business reviews (optional) ─────────────────────────────
  // Paste these in once you have them; until then the Google endpoint
  // returns an empty list and nothing breaks.
  google: {
    apiKey: (process.env.GOOGLE_API_KEY || '').trim(),
    placeId: (process.env.GOOGLE_PLACE_ID || '').trim(),
    // How long to cache Google's response (minutes) — avoids per-request billing.
    cacheTtlMs: (Number(process.env.GOOGLE_CACHE_TTL_MIN) || 360) * 60 * 1000,
  },

  // ── Owner SMS alerts via carrier email-to-SMS gateway (no Twilio) ──
  // Sends a text straight to your phone through your carrier's free
  // email-to-SMS gateway. Requires SMTP creds to send the email.
  sms: {
    // Owner's phone (raw digits) — used by real SMS providers like TextBelt.
    phone: (process.env.SMS_PHONE || '').replace(/[^0-9]/g, ''),

    // Preferred: a real SMS API (reliable). TextBelt = pay-as-you-go, no monthly fee.
    textbeltKey: (process.env.TEXTBELT_KEY || '').trim(),

    // Fallback: carrier email-to-SMS gateway (free but unreliable).
    host: (process.env.SMTP_HOST || '').trim(),
    port: Number(process.env.SMTP_PORT) || 587,
    user: (process.env.SMTP_USER || '').trim(),
    pass: process.env.SMTP_PASS || '',
    from: (process.env.SMS_FROM || process.env.SMTP_USER || '').trim(),
    to: (process.env.SMS_TO || '').trim(),
  },
};

export const googleConfigured = () =>
  Boolean(config.google.apiKey && config.google.placeId);

/** Reliable SMS via TextBelt is preferred; email gateway is the fallback. */
export const smsProvider = () => {
  if (config.sms.textbeltKey && config.sms.phone) return 'textbelt';
  if (config.sms.host && config.sms.user && config.sms.pass && config.sms.to) return 'email';
  return 'none';
};
export const smsConfigured = () => smsProvider() !== 'none';

if (!config.adminToken && isProd) {
  console.error('[config] ADMIN_TOKEN is required in production. Refusing to start.');
  process.exit(1);
}

if (!config.jwtSecret) {
  if (isProd) {
    console.error('[config] JWT_SECRET is required in production. Refusing to start.');
    process.exit(1);
  }
  // Dev fallback so the server still boots; sessions won't survive a restart.
  config.jwtSecret = 'dev-insecure-jwt-secret-change-me';
  console.warn('[config] JWT_SECRET not set — using an insecure dev fallback.');
}
