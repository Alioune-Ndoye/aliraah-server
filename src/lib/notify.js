import nodemailer from 'nodemailer';
import { config, smsConfigured } from '../config.js';

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

/** Fire-and-forget text to the owner. Never throws into the request path. */
export async function notifyOwner(text) {
  if (!smsConfigured()) {
    console.warn('[notify] SMS not configured — skipping alert.');
    return;
  }
  try {
    await getTransport().sendMail({
      from: config.sms.from,
      to: config.sms.to,
      // Carrier gateways ignore/echo the subject; keep the body short.
      subject: '',
      text: String(text).slice(0, 300),
    });
    console.log('[notify] SMS alert sent.');
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
