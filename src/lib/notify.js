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
async function sendViaTextbelt(text) {
  const res = await fetch('https://textbelt.com/text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: config.sms.phone,
      message: String(text).slice(0, 300),
      key: config.sms.textbeltKey,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.success) throw new Error(data.error || 'TextBelt send failed');
  console.log(`[notify] SMS sent via TextBelt (quota left: ${data.quotaRemaining}).`);
}

/** Free-but-unreliable fallback: carrier email-to-SMS gateway. */
async function sendViaEmailGateway(text) {
  await getTransport().sendMail({
    from: config.sms.from,
    to: config.sms.to,
    subject: '',
    text: String(text).slice(0, 300),
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

/** Short one-line summary of a new booking for a text message. */
export function bookingSms(b) {
  const name = `${b.firstName || ''} ${b.lastName || ''}`.trim();
  const when = [b.date, b.time].filter(Boolean).join(' ');
  const money = b.estimatedTotal ? ` $${Math.round(b.estimatedTotal)}` : '';
  const label = b.kind === 'quote' ? 'Quote request' : 'New booking';
  return `${label}: ${name}${money} ${b.frequency || ''} ${when} ${b.phone || ''}`.replace(/\s+/g, ' ').trim();
}
