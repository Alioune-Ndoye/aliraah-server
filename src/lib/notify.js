import nodemailer from 'nodemailer';
import { config, smsConfigured, smsProvider } from '../config.js';

/**
 * Owner SMS alerts via a carrier email-to-SMS gateway (e.g. Boost Mobile:
 * <10-digit-number>@sms.myboostmobile.com). No Twilio — we just send a short
 * email to the gateway address and the carrier delivers it as a text.
 *
 * No-op (with a warning) until SMTP creds + SMS_TO are configured, so the
 * booking flow never breaks if alerts aren't set up.
 */

let transporter = null;
function getTransport() {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: config.sms.host,
    port: config.sms.port,
    secure: config.sms.port === 465, // 465 = implicit TLS, 587 = STARTTLS
    auth: { user: config.sms.user, pass: config.sms.pass },
  });
  return transporter;
}

/** Reliable SMS via TextBelt (pay-as-you-go HTTP API). */
async function sendViaTextbelt(text, phone = config.sms.phone) {
  const res = await fetch('https://textbelt.com/text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone,
      message: String(text).slice(0, 900),
      key: config.sms.textbeltKey,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.success) throw new Error(data.error || 'TextBelt send failed');
  console.log(`[notify] SMS sent via TextBelt (quota left: ${data.quotaRemaining}).`);
}

/** Fire-and-forget text to ANY phone (e.g. a cleaner's job offer).
 *  Requires TextBelt; never throws into the request path. */
export async function sendSms(phone, text) {
  const digits = String(phone).replace(/[^0-9]/g, '');
  if (!config.sms.textbeltKey || !digits) {
    console.warn('[notify] sendSms skipped (no TextBelt key or bad phone).');
    return;
  }
  try {
    await sendViaTextbelt(text, digits);
  } catch (err) {
    console.error('[notify] sendSms failed:', err.message);
  }
}

/** Free-but-unreliable fallback: carrier email-to-SMS gateway. */
async function sendViaEmailGateway(text) {
  await getTransport().sendMail({
    from: config.sms.from,
    to: config.sms.to,
    subject: '',
    text: String(text).slice(0, 900),
  });
  console.log('[notify] SMS sent via email gateway.');
}

/** Fire-and-forget text to the owner. Never throws into the request path. */
export async function notifyOwner(text) {
  const provider = smsProvider();
  if (provider === 'none') {
    console.warn('[notify] SMS not configured — skipping alert.');
    return;
  }
  try {
    if (provider === 'textbelt') await sendViaTextbelt(text);
    else await sendViaEmailGateway(text);
  } catch (err) {
    console.error('[notify] SMS send failed:', err.message);
  }
}

/** Full, readable text of a new booking/quote — every detail the owner needs. */
export function bookingSms(b) {
  const label = b.kind === 'quote' ? 'NEW QUOTE REQUEST' : 'NEW BOOKING';
  const name = `${b.firstName || ''} ${b.lastName || ''}`.trim();
  const addr = [b.street, b.apt, b.city, b.state, b.zip].filter(Boolean).join(', ');
  const svc = [b.size, b.bedrooms, b.bathrooms].filter(Boolean).join(' / ');
  const when = [b.date, b.time].filter(Boolean).join(' ');
  const extras = Array.isArray(b.extras) && b.extras.length ? b.extras.join(', ') : '';

  const lines = [
    `${label} - Aliraah`,
    name && `Name: ${name}`,
    b.phone && `Phone: ${b.phone}`,
    // Obfuscate the email so unverified SMS keys don't flag it as a link.
    // (Whitelist the key to show it as a normal tappable address.)
    b.email && `Email: ${b.email.replace('@', ' (at) ').replace(/\.(?=[a-z]{2,})/gi, ' (dot) ')}`,
    addr && `Address: ${addr}`,
    svc && `Home: ${svc}`,
    b.frequency && `Frequency: ${b.frequency}`,
    extras && `Extras: ${extras}`,
    when && `When: ${when}`,
    b.access && `Access: ${b.access}`,
    b.estimatedTotal ? `Est. total: $${Math.round(b.estimatedTotal)}` : '',
    b.tip ? `Tip: $${Math.round(b.tip)}` : '',
    b.notes && `Notes: ${b.notes}`,
  ].filter(Boolean);

  return lines.join('\n');
}
