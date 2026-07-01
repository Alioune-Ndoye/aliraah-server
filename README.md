# Aalirah API

Secure Node/Express + MongoDB backend for the **React app** (`../react-app`). It
stores customer reviews submitted from the post-service link (`/review`) and
serves approved reviews back to the Reviews page.

It is **not** connected to the PHP site — the PHP site is unchanged.

## Setup

1. **Install** (already done if you see `node_modules/`):
   ```bash
   cd server
   npm install
   ```

2. **Add your MongoDB link.** Open `server/.env` and paste your Atlas
   connection string into `MONGODB_URI=`. (`.env` is git-ignored — it never
   gets committed.)

3. **Run the API:**
   ```bash
   npm run dev      # auto-restarts on change
   # → [api] listening on http://localhost:4000
   ```

4. **Connect the React app.** In `react-app/.env` (copy from
   `react-app/.env.example`) set:
   ```
   VITE_API_URL=http://localhost:4000
   ```
   Restart `npm run dev` in `react-app`. Submissions now go to MongoDB instead
   of localStorage. Leave `VITE_API_URL` empty to keep the offline demo.

## Verify it works

```bash
npm run test:smoke   # spins up an in-memory Mongo and runs 12 end-to-end checks
```

## Endpoints

| Method | Path                       | Access  | Purpose                          |
|--------|----------------------------|---------|----------------------------------|
| GET    | `/api/health`              | public  | Liveness check                   |
| POST   | `/api/reviews`             | public  | Submit a review (held: pending)  |
| GET    | `/api/reviews`             | public  | List **approved** reviews        |
| GET    | `/api/reviews/google`      | public  | Google Business reviews (empty until configured) |
| GET    | `/api/reviews/pending`     | admin   | Moderation queue                 |
| PATCH  | `/api/reviews/:id/status`  | admin   | Approve / reject a review        |

Admin routes need `Authorization: Bearer <ADMIN_TOKEN>` (token is in `.env`).

Approve a review:
```bash
curl -X PATCH http://localhost:4000/api/reviews/<id>/status \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"approved"}'
```

## Security — see [SECURITY.md](./SECURITY.md)

## Google Business reviews

The Reviews page shows a **combined wall**: your own (video) reviews + your
Google Business reviews. To enable Google, set `GOOGLE_API_KEY` and
`GOOGLE_PLACE_ID` in `.env` (see template). Until then the Google endpoint
returns `[]` and the page just shows your own reviews.

> Note: Google reviews are **text + rating + reviewer photo only** — Google has
> no video reviews. Video testimonials come from the site's own `/review` flow.
> Both are merged on the page. The Places API returns up to ~5 reviews; the full
> set requires upgrading `services/googleReviews.js` to the Google Business
> Profile API (OAuth + Google approval).

## Not yet built (next steps)
- **Video file storage.** The API stores review *text/rating/name* + an optional
  external video **URL**. Raw recorded/uploaded clips need object storage
  (S3 / Cloudinary / GridFS) — that's the next piece before video uploads work
  against the backend.
- **Post-service trigger** (auto text/email with the `/review?job=ID` link).
- **Full Google review sync** via the Business Profile API (all reviews).
