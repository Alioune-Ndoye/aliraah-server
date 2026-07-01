# Security

Protecting customer information is the priority for this API. Here's what's in
place and what you must do operationally.

## What the code already enforces

| Threat | Mitigation | Where |
|--------|-----------|-------|
| Secrets in source | `MONGODB_URI` / `ADMIN_TOKEN` live only in `.env` (git-ignored) | `config.js`, `.gitignore` |
| NoSQL injection | `express-mongo-sanitize` strips `$`/`.` operators; Zod validates every field; Mongoose `strict: 'throw'` rejects unknown fields | `middleware/security.js`, `routes/reviews.js`, `models/Review.js` |
| XSS / clickjacking / sniffing | `helmet` security headers (CSP, HSTS, X-Frame-Options, nosniff) | `middleware/security.js` |
| Cross-origin abuse | Strict CORS allowlist (`CORS_ORIGINS`) — only your domains may call the API | `middleware/security.js` |
| Spam / brute force | Rate limiting: 300 req/15 min globally, **8 review POSTs/hour/IP** | `middleware/security.js` |
| Parameter pollution | `hpp` | `middleware/security.js` |
| Oversized payloads | JSON body capped at 64 kb | `app.js` |
| Public exposure of bad/PII data | Reviews are **pending** until an admin approves; public API returns only `name/role/rating/text/video` — never `ipHash`, `jobRef`, `userAgent` | `models/Review.js` (`toPublic`), `routes/reviews.js` |
| IP stored as PII | IPs are **salted-SHA256 hashed**, never stored raw | `routes/reviews.js` |
| Admin endpoint takeover | Bearer token with constant-time comparison | `middleware/security.js` |
| Info leakage on errors | Central handler returns generic messages; no stack traces to clients | `app.js` |

## What YOU must do (operational — code can't do these for you)

1. **MongoDB Atlas hardening**
   - Create a **dedicated DB user** with `readWrite` on the `aalirah` DB only — not an admin user.
   - Use a long random password.
   - **Network Access:** restrict to your server's IP (avoid `0.0.0.0/0`).
   - Enable Atlas **encryption at rest** (on by default) and **backups**.
2. **Always serve over HTTPS/TLS** in production (terminate TLS at your host/proxy). Atlas connections are already TLS.
3. **Rotate `ADMIN_TOKEN`** if it's ever shared or exposed. Regenerate:
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
4. **Set `NODE_ENV=production`** when deploying (the app refuses to start in prod without an `ADMIN_TOKEN`).
5. **Keep dependencies patched:** run `npm audit` periodically.

## Automated security review ("AI cybersecurity agent")

Claude Code includes a `/security-review` skill that audits the pending diff for
vulnerabilities. To make it continuous (the "always-watching agent" idea), it can
be wired as a scheduled cloud routine or a CI check that runs on every change and
flags issues. Say the word and I'll set that up — it's the realistic, effective
version of an autonomous security agent for this codebase.
