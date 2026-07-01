/**
 * End-to-end smoke test against an in-memory MongoDB — no real Atlas needed.
 * Verifies: validation, moderation gating, admin auth, NoSQL-injection sanitising.
 * Run: npm run test:smoke
 */
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongo = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongo.getUri('aalirah_test');
process.env.ADMIN_TOKEN = 'test-admin-token';
process.env.JWT_SECRET = 'test-jwt-secret-value';
process.env.NODE_ENV = 'test';
process.env.PORT = '4555';

const { connectDb, disconnectDb } = await import('../src/db.js');
const { createApp } = await import('../src/app.js');

await connectDb();
const app = createApp();
const server = app.listen(4555);
const base = 'http://localhost:4555';

let pass = 0;
let fail = 0;
const ok = (name, cond) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
};
const post = (path, body, headers = {}) =>
  fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const get = (path, headers = {}) => fetch(base + path, { headers });

try {
  // Health
  ok('health responds', (await (await get('/api/health')).json()).ok === true);

  // Google reviews endpoint is a safe no-op until configured
  const g = await (await get('/api/reviews/google')).json();
  ok('google endpoint returns empty when unconfigured', Array.isArray(g.reviews) && g.reviews.length === 0);

  // Reject invalid (rating out of range)
  ok('rejects rating > 5', (await post('/api/reviews', { name: 'X', rating: 9, text: 'hi' })).status === 400);

  // Reject empty (no text, no video)
  ok('rejects empty review', (await post('/api/reviews', { name: 'X', rating: 5 })).status === 400);

  // Valid submission → pending
  const created = await post('/api/reviews', { name: 'Maria G.', rating: 5, text: 'Spotless work!', jobRef: 'A1029' });
  const createdBody = await created.json();
  ok('accepts valid review (201)', created.status === 201);
  ok('new review is pending', createdBody.status === 'pending');

  // NoSQL injection attempt is sanitised (operators stripped, treated as plain data → invalid name)
  const inj = await post('/api/reviews', { name: { $ne: null }, rating: 5, text: 'x' });
  ok('blocks NoSQL operator injection', inj.status === 400);

  // Public list excludes pending
  const pub1 = await (await get('/api/reviews')).json();
  ok('pending review hidden from public list', pub1.reviews.length === 0);

  // Admin auth required for moderation
  ok('moderation needs auth', (await get('/api/reviews/pending')).status === 401);

  // Admin can see pending
  const auth = { Authorization: 'Bearer test-admin-token' };
  const pend = await (await get('/api/reviews/pending', auth)).json();
  ok('admin sees pending review', pend.reviews.length === 1);

  // Approve it
  const id = createdBody.review.id;
  const approved = await fetch(`${base}/api/reviews/${id}/status`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify({ status: 'approved' }),
  });
  ok('admin approves review', approved.status === 200);

  // Now public list includes it, without internal fields
  const pub2 = await (await get('/api/reviews')).json();
  ok('approved review now public', pub2.reviews.length === 1);
  ok('public review hides ipHash/jobRef', !('ipHash' in pub2.reviews[0]) && !('jobRef' in pub2.reviews[0]));
  // ── Bookings ──────────────────────────────────────────────
  const auth2 = { Authorization: 'Bearer test-admin-token' };
  ok('rejects booking without contact', (await post('/api/bookings', { firstName: 'X' })).status === 400);

  const bk = await post('/api/bookings', {
    firstName: 'Jane', lastName: 'Smith', email: 'jane@example.com', phone: '3470001234',
    street: '123 Main St', city: 'West Hartford', state: 'CT', zip: '06110',
    size: '1000to1500', bedrooms: '2bed', bathrooms: '2bath', frequency: 'Every 2 Weeks',
    extras: ['Deep Cleaning'], date: '2026-07-10', time: '9:00 AM', estimatedTotal: 234.5,
  });
  ok('accepts valid booking (201)', bk.status === 201);

  ok('bookings list needs auth', (await get('/api/bookings')).status === 401);
  const list = await (await get('/api/bookings', auth2)).json();
  ok('admin sees the booking', list.bookings.length === 1 && list.bookings[0].firstName === 'Jane');
  ok('booking starts as new', list.bookings[0].status === 'new');

  const bid = list.bookings[0]._id;
  const upd = await fetch(`${base}/api/bookings/${bid}/status`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...auth2 }, body: JSON.stringify({ status: 'scheduled' }),
  });
  ok('admin updates booking status', upd.status === 200 && (await upd.json()).status === 'scheduled');

  const csv = await get('/api/bookings/export.csv', auth2);
  const csvText = await csv.text();
  ok('CSV export works', csv.status === 200 && csvText.includes('jane@example.com') && csvText.startsWith('createdAt,'));

  // ── Customer auth & accounts ──────────────────────────────
  const cookieOf = (res) => (res.headers.get('set-cookie') || '').match(/aliraah_session=[^;]+/)?.[0] || '';

  ok('rejects short password on signup', (await post('/api/auth/signup', { firstName: 'Al', email: 'al@example.com', password: 'short' })).status === 400);

  const su = await post('/api/auth/signup', {
    firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', password: 'sup3rsecret!',
    phone: '8601112222', street: '10 Byron Rd', city: 'West Hartford', state: 'CT', zip: '06117',
  });
  const suBody = await su.json();
  const cookie = cookieOf(su);
  ok('signup succeeds (201)', su.status === 201);
  ok('signup returns AL- account number', /^AL-\d{6}$/.test(suBody.customer?.accountNumber || ''));
  ok('signup sets session cookie', cookie.startsWith('aliraah_session='));
  ok('signup never leaks passwordHash', !('passwordHash' in (suBody.customer || {})));

  ok('duplicate email rejected (409)', (await post('/api/auth/signup', { firstName: 'Ada', email: 'ada@example.com', password: 'sup3rsecret!' })).status === 409);

  // /me with cookie
  const me = await (await get('/api/auth/me', { Cookie: cookie })).json();
  ok('me returns current customer', me.customer?.email === 'ada@example.com');
  ok('me without cookie is null', (await (await get('/api/auth/me')).json()).customer === null);

  // login: wrong password → generic 401
  const badLogin = await post('/api/auth/login', { email: 'ada@example.com', password: 'wrongpass' });
  ok('login rejects wrong password (401)', badLogin.status === 401);
  ok('login error is generic', (await badLogin.json()).error === 'Invalid email or password.');

  const login = await post('/api/auth/login', { email: 'ada@example.com', password: 'sup3rsecret!' });
  const loginCookie = cookieOf(login);
  ok('login succeeds', login.status === 200 && loginCookie.startsWith('aliraah_session='));

  // account bookings require auth
  ok('account bookings need cookie', (await get('/api/account/bookings')).status === 401);

  // booking while logged in → links to customer
  const cbk = await post('/api/bookings', {
    firstName: 'Ada', email: 'ada@example.com', phone: '8601112222', size: 'under1000',
    bedrooms: 'studio', bathrooms: '1bath', frequency: 'Weekly', estimatedTotal: 137,
  }, { Cookie: loginCookie });
  ok('logged-in booking accepted', cbk.status === 201);

  const myBookings = await (await get('/api/account/bookings', { Cookie: loginCookie })).json();
  ok('portal shows my booking', myBookings.bookings.length >= 1 && myBookings.bookings.some((b) => b.customerId));

  // profile self-update (allowed field) + cannot change tier via profile route
  const prof = await fetch(`${base}/api/account/profile`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: loginCookie }, body: JSON.stringify({ phone: '8609998888', tier: 'gold' }),
  });
  const profBody = await prof.json();
  ok('profile update succeeds', prof.status === 200 && profBody.customer.phone === '8609998888');
  ok('customer cannot self-assign tier', profBody.customer.tier === 'standard');

  // ── Admin customer management ─────────────────────────────
  ok('admin customers need auth', (await get('/api/admin/customers')).status === 401);
  const custList = await (await get('/api/admin/customers?q=ada', auth2)).json();
  ok('admin can search customers', custList.customers.length === 1 && custList.customers[0].email === 'ada@example.com');

  const custId = custList.customers[0].id;
  const detail = await (await get(`/api/admin/customers/${custId}`, auth2)).json();
  ok('admin sees customer + their bookings', detail.customer.id === custId && detail.bookings.length >= 1);

  const edited = await fetch(`${base}/api/admin/customers/${custId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...auth2 }, body: JSON.stringify({ tier: 'gold', discountRate: 15, recurring: true }),
  });
  const editedBody = await edited.json();
  ok('admin sets tier/discount/recurring', edited.status === 200 && editedBody.customer.tier === 'gold' && editedBody.customer.discountRate === 15 && editedBody.customer.recurring === true);
  ok('admin response hides passwordHash', !('passwordHash' in editedBody.customer));

  // logout clears the session
  const lo = await post('/api/auth/logout', {}, { Cookie: loginCookie });
  ok('logout clears cookie', lo.status === 200 && /aliraah_session=;|Expires=Thu, 01 Jan 1970/.test(lo.headers.get('set-cookie') || ''));
} finally {
  server.close();
  await disconnectDb();
  await mongo.stop();
}

console.log(`\n${fail === 0 ? '✅ ALL PASSED' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
