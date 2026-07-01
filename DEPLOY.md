# Deploying the Aliraah API

The API is a Node/Express server backed by MongoDB Atlas. Recommended host: **Render** (free tier).

## 1. Create the service on Render
1. Go to <https://render.com> → **New → Web Service**.
2. Connect this GitHub repo (`Alioune-Ndoye/aliraah-server`).
3. Render detects `render.yaml`. Confirm:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Health Check Path:** `/api/health`

## 2. Set environment variables (Dashboard → Environment)
These are **secrets** — set them in Render, never commit them:

| Key | Value |
|-----|-------|
| `NODE_ENV` | `production` |
| `MONGODB_URI` | your Atlas connection string (same as local `.env`) |
| `JWT_SECRET` | your long random JWT secret |
| `ADMIN_TOKEN` | your admin passcode |
| `CORS_ORIGINS` | `https://aliraah.com,https://www.aliraah.com,https://<your-vercel-domain>.vercel.app` |
| `GOOGLE_API_KEY` | *(optional)* Google Places key |
| `GOOGLE_PLACE_ID` | *(optional)* your Place ID |

## 3. Deploy
Render builds and gives you a URL like `https://aliraah-api.onrender.com`.
Verify it: open `https://aliraah-api.onrender.com/api/health` → should return `{"ok":true,...}`.

## 4. Connect the frontend
In **Vercel** → the `aalirah` project → **Settings → Environment Variables**:
- `VITE_API_URL` = `https://aliraah-api.onrender.com`

Then **redeploy** the frontend. Booking, login, reviews, and the dashboard will now work.

## Owner SMS alerts (text on every booking)
The API texts you on each new booking. It picks a provider automatically:

### Preferred — TextBelt (reliable, pay-as-you-go, no monthly fee)
1. Buy a key at <https://textbelt.com> (e.g. $5 ≈ hundreds of texts).
2. Set:

| Key | Value |
|-----|-------|
| `SMS_PHONE` | `8608950233` (your mobile, digits only) |
| `TEXTBELT_KEY` | your TextBelt API key |

That's it — reliable texts, no email needed.

### Fallback — carrier email-to-SMS gateway (free but unreliable)
Only used if `TEXTBELT_KEY` is not set. Requires SMTP creds:
`SMS_TO`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMS_FROM`.
Note: carrier gateways (esp. Boost) frequently drop mail — not recommended.

If nothing is configured, the alert is skipped and booking still works.

## Notes
- **Cookies:** in production the API sets `SameSite=None; Secure` session cookies automatically (`NODE_ENV=production`). For these to work across `aliraah.com` ↔ the API, both must be HTTPS (Render + Vercel both are).
- **Atlas Network Access:** allow Render's outbound IPs, or (simpler on free tier) `0.0.0.0/0` with a strong DB password.
- **Free tier sleeps:** Render's free web service spins down after inactivity; the first request after idle takes ~30s to wake. Upgrade to a paid instance to keep it always-on.
