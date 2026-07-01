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

## Notes
- **Cookies:** in production the API sets `SameSite=None; Secure` session cookies automatically (`NODE_ENV=production`). For these to work across `aliraah.com` ↔ the API, both must be HTTPS (Render + Vercel both are).
- **Atlas Network Access:** allow Render's outbound IPs, or (simpler on free tier) `0.0.0.0/0` with a strong DB password.
- **Free tier sleeps:** Render's free web service spins down after inactivity; the first request after idle takes ~30s to wake. Upgrade to a paid instance to keep it always-on.
