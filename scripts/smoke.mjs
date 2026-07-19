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
process.env.WRITE_LIMIT_MAX = '100'; // suite fires many submissions from one IP
process.env.AUTH_LIMIT_MAX = '100';
// Never send real owner alerts (SMS/email) from tests — blank out providers
// even if the local .env has them configured.
process.env.TEXTBELT_KEY = '';
process.env.SMS_PHONE = '';
process.env.SMTP_HOST = '';
process.env.SMTP_USER = '';
process.env.SMTP_PASS = '';
process.env.SMS_TO = '';

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
  ok('signup succeeds (201) as pending', su.status === 201 && suBody.pending === true);
  ok('signup gives NO session cookie (owner approval required)', cookieOf(su) === '');
  ok('signup exposes code only in test env', /^\d{6}$/.test(suBody.devCode || ''));

  ok('duplicate email rejected (409)', (await post('/api/auth/signup', { firstName: 'Ada', email: 'ada@example.com', password: 'sup3rsecret!' })).status === 409);

  // login before approval → 403 pending (even with the right password)
  const preLogin = await post('/api/auth/login', { email: 'ada@example.com', password: 'sup3rsecret!' });
  ok('login before approval → 403 pending', preLogin.status === 403 && (await preLogin.json()).pending === true);

  // wrong code rejected; correct code activates + signs in
  ok('wrong code rejected', (await post('/api/auth/verify', { email: 'ada@example.com', code: '000000' })).status === 401);
  const ver = await post('/api/auth/verify', { email: 'ada@example.com', code: suBody.devCode });
  const verBody = await ver.json();
  const cookie = cookieOf(ver);
  ok('correct code verifies + signs in', ver.status === 200 && verBody.verified === true && cookie.startsWith('aliraah_session='));
  ok('verify returns AL- account number', /^AL-\d{6}$/.test(verBody.customer?.accountNumber || ''));
  ok('verify never leaks passwordHash', !('passwordHash' in (verBody.customer || {})));
  ok('code is single-use', (await post('/api/auth/verify', { email: 'ada@example.com', code: suBody.devCode })).status === 200 && !cookieOf(await post('/api/auth/verify', { email: 'ada@example.com', code: suBody.devCode })).startsWith('aliraah_session='));

  // resend is generic (no user enumeration)
  const rs = await post('/api/auth/resend-code', { email: 'ghost@example.com' });
  ok('resend-code is generic for unknown emails', rs.status === 200 && (await rs.json()).ok === true);

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
  ok('login succeeds after approval', login.status === 200 && loginCookie.startsWith('aliraah_session='));

  // account bookings require auth
  ok('account bookings need cookie', (await get('/api/account/bookings')).status === 401);

  // booking while logged in → links to customer
  const cbk = await post('/api/bookings', {
    firstName: 'Ada', email: 'ada@example.com', phone: '8601112222', size: 'under1000',
    bedrooms: 'studio', bathrooms: '1bath', frequency: 'Weekly', estimatedTotal: 137,
  }, { Cookie: loginCookie });
  ok('logged-in booking accepted', cbk.status === 201);
  const adaBid = (await cbk.json()).id;

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

  // ── Admin approve fallback (activate accounts without SMS codes) ──
  const bobSu = await post('/api/auth/signup', { firstName: 'Bob', email: 'bob@example.com', password: 'bobSecret123!' });
  ok('second signup pending', bobSu.status === 201 && (await bobSu.json()).pending === true);

  const bobList = await (await get('/api/admin/customers?q=bob', auth2)).json();
  const bob = bobList.customers.find((c) => c.email === 'bob@example.com');
  ok('admin sees pending customer (verified:false)', bob && bob.verified === false);

  const appr = await fetch(`${base}/api/admin/customers/${bob.id}/approve`, { method: 'POST', headers: auth2 });
  ok('admin approves without code', appr.status === 200 && (await appr.json()).customer.verified === true);
  ok('approve needs admin auth', (await fetch(`${base}/api/admin/customers/${bob.id}/approve`, { method: 'POST' })).status === 401);

  const bobLogin = await post('/api/auth/login', { email: 'bob@example.com', password: 'bobSecret123!' });
  ok('approved customer logs in (no code ever entered)', bobLogin.status === 200 && cookieOf(bobLogin).startsWith('aliraah_session='));

  // logout clears the session
  const lo = await post('/api/auth/logout', {}, { Cookie: loginCookie });
  ok('logout clears cookie', lo.status === 200 && /aliraah_session=;|Expires=Thu, 01 Jan 1970/.test(lo.headers.get('set-cookie') || ''));

  // ── Property-manager portfolio ───────────────────────────────────
  ok('properties need cookie', (await get('/api/account/properties')).status === 401);

  const p1 = await post('/api/account/properties', {
    label: '123 Main St · Unit 2B', street: '123 Main St', apt: '2B', city: 'West Hartford', state: 'CT', zip: '06110',
    bedrooms: '2 Bedrooms', bathrooms: '1 Bathroom',
  }, { Cookie: loginCookie });
  const p1Body = await p1.json();
  ok('PM adds property (201)', p1.status === 201 && p1Body.property.label === '123 Main St · Unit 2B');
  const propId = p1Body.property.id;

  const plist = await (await get('/api/account/properties', { Cookie: loginCookie })).json();
  ok('PM lists own properties', plist.properties.length === 1);

  // Booking linked to a property I own → propertyId persists
  const pbk = await post('/api/bookings', {
    firstName: 'Ada', email: 'ada@example.com', phone: '8601112222', frequency: 'Monthly',
    estimatedTotal: 150, propertyId: propId,
  }, { Cookie: loginCookie });
  ok('property booking accepted', pbk.status === 201);
  const myB2 = await (await get('/api/account/bookings', { Cookie: loginCookie })).json();
  ok('booking carries propertyId', myB2.bookings.some((b) => String(b.propertyId) === propId));

  // Someone else's propertyId is silently dropped (no cross-account linking)
  const stranger = await post('/api/bookings', {
    firstName: 'Guest', email: 'guest@example.com', phone: '8600000000', propertyId: propId,
  });
  ok('guest booking accepted', stranger.status === 201);
  const adminList2 = await (await get('/api/bookings?limit=10', auth2)).json();
  const guestBk = adminList2.bookings.find((b) => b.email === 'guest@example.com');
  ok('foreign propertyId NOT honored', guestBk && !guestBk.propertyId);

  // Archive keeps it around for history
  const arch = await fetch(`${base}/api/account/properties/${propId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: loginCookie }, body: JSON.stringify({ archived: true }),
  });
  ok('PM archives property', arch.status === 200 && (await arch.json()).property.archived === true);

  // Admin flips account type to property_manager
  const at = await fetch(`${base}/api/admin/customers/${custId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...auth2 }, body: JSON.stringify({ accountType: 'property_manager' }),
  });
  ok('admin sets accountType', at.status === 200 && (await at.json()).customer.accountType === 'property_manager');

  // ── Crew dispatch (cleaners, assignment, accept → done) ─────────
  ok('cleaners list needs admin', (await get('/api/admin/cleaners')).status === 401);

  const mkCleaner = await fetch(`${base}/api/admin/cleaners`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...auth2 },
    body: JSON.stringify({ firstName: 'Maria', lastName: 'Gomez', phone: '8605553333' }),
  });
  const mkBody = await mkCleaner.json();
  const crewToken = mkBody.cleaner?.token || '';
  ok('admin creates cleaner (201)', mkCleaner.status === 201 && /^[a-f0-9]{32}$/.test(crewToken));

  const assign = await fetch(`${base}/api/admin/cleaners/assign/${adaBid}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...auth2 },
    body: JSON.stringify({ cleanerId: mkBody.cleaner.id }),
  });
  ok('admin assigns job (offered)', assign.status === 200 && (await assign.json()).dispatch === 'offered');

  ok('crew page rejects bad token', (await get('/api/crew/deadbeefdeadbeefdeadbeefdeadbeef')).status === 404);

  const crew = await (await get(`/api/crew/${crewToken}`)).json();
  ok('crew sees offered job', crew.jobs?.length === 1 && crew.jobs[0].dispatch === 'offered');
  ok('crew job hides price & email', !('estimatedTotal' in crew.jobs[0]) && !('email' in crew.jobs[0]));

  const crewAct = (action) => fetch(`${base}/api/crew/${crewToken}/jobs/${adaBid}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
  });
  ok('crew cannot skip to done from offered', (await crewAct('done')).status === 409);
  ok('crew accepts job', (await (await crewAct('accept')).json()).dispatch === 'accepted');
  ok('crew on the way', (await (await crewAct('on_the_way')).json()).dispatch === 'on_the_way');
  ok('crew completes job', (await (await crewAct('done')).json()).dispatch === 'done');

  // Customer portal shows the cleaner's first name + dispatch on their booking.
  const myB = await (await get('/api/account/bookings', { Cookie: loginCookie })).json();
  const dispatched = (myB.bookings || []).find((b) => b.dispatch === 'done');
  ok('customer sees dispatch + cleaner first name', !!dispatched && dispatched.cleanerId?.firstName === 'Maria');

  // ── Payments scaffold + booking meta (photos / payment status) ───
  ok('checkout needs login', (await post(`/api/payments/checkout/${adaBid}`, {})).status === 401);

  const co = await post(`/api/payments/checkout/${adaBid}`, {}, { Cookie: loginCookie });
  const coBody = await co.json();
  ok('checkout is a graceful 503 until Stripe keys exist', co.status === 503 && coBody.pending === true);

  // Ada can't pay a booking that isn't hers (Jane's guest booking)
  ok('cannot checkout someone else\'s booking', (await post(`/api/payments/checkout/${bid}`, {}, { Cookie: loginCookie })).status === 404);

  const meta = await fetch(`${base}/api/bookings/${adaBid}/meta`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...auth2 },
    body: JSON.stringify({ paymentStatus: 'paid', photos: [
      { url: 'https://example.com/before.jpg', kind: 'before' },
      { url: 'https://example.com/after.jpg', kind: 'after' },
    ] }),
  });
  const metaBody = await meta.json();
  ok('admin sets payment + photos', meta.status === 200 && metaBody.paymentStatus === 'paid' && metaBody.photos.length === 2);
  ok('meta rejects http photo urls', (await fetch(`${base}/api/bookings/${adaBid}/meta`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...auth2 },
    body: JSON.stringify({ photos: [{ url: 'http://insecure.com/x.jpg', kind: 'before' }] }),
  })).status === 400);
  ok('meta needs admin', (await fetch(`${base}/api/bookings/${adaBid}/meta`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paymentStatus: 'paid' }),
  })).status === 401);

  const myB3 = await (await get('/api/account/bookings', { Cookie: loginCookie })).json();
  const paidBk = myB3.bookings.find((b) => String(b._id) === adaBid);
  ok('portal sees paymentStatus + photos', paidBk?.paymentStatus === 'paid' && paidBk?.photos?.length === 2);

  ok('paid booking refuses re-checkout', (await post(`/api/payments/checkout/${adaBid}`, {}, { Cookie: loginCookie })).status === 400);

  // ── Site settings (admin feature toggles) ────────────────────────
  const s0 = await (await get('/api/settings')).json();
  ok('settings default OFF', s0.settings.showGuarantee === false && s0.settings.showSpecials === false);

  const sNoAuth = await fetch(`${base}/api/settings`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ showSpecials: true }),
  });
  ok('settings PATCH needs admin', sNoAuth.status === 401);

  const sOn = await fetch(`${base}/api/settings`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...auth2 }, body: JSON.stringify({ showSpecials: true, showGuarantee: true }),
  });
  const sOnBody = await sOn.json();
  ok('admin enables toggles', sOn.status === 200 && sOnBody.settings.showSpecials === true && sOnBody.settings.showGuarantee === true);

  const s1 = await (await get('/api/settings')).json();
  ok('toggles persist publicly', s1.settings.showSpecials === true && s1.settings.showGuarantee === true);

  const sBad = await fetch(`${base}/api/settings`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...auth2 }, body: JSON.stringify({ hacked: true }),
  });
  ok('settings rejects unknown fields', sBad.status === 400);
} finally {
  server.close();
  await disconnectDb();
  await mongo.stop();
}

console.log(`\n${fail === 0 ? '✅ ALL PASSED' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
