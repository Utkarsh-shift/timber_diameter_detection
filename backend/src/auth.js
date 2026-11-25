import crypto from 'node:crypto';
import { Router } from 'express';
import { all, get, run } from './db.js';

// Accounts belong to exactly one company. A login creates a server-side session whose id is kept in an
// HttpOnly cookie; the company of every request comes from that session, never from anything the client sends.
const COOKIE = 'pine_session';
const TTL = 7 * 86400000;
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');

export const hashPassword = (pw, salt = crypto.randomBytes(16).toString('hex')) => `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
const DUMMY = hashPassword('not-a-real-password');
const verify = (pw, stored) => {
  const [salt, h] = stored.split(':');
  const a = crypto.scryptSync(pw, salt, 64), b = Buffer.from(h, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim()).filter(Boolean).map((c) => { const i = c.indexOf('='); return [c.slice(0, i), decodeURIComponent(c.slice(i + 1))]; }));
export const sessionUser = (req) => {
  const t = cookies(req)[COOKIE];
  if (!t) return null;
  return get('SELECT u.id, u.email, u.name, u.company_id, c.name company FROM sessions s JOIN users u ON u.id=s.user_id JOIN companies c ON c.id=u.company_id WHERE s.token=? AND s.expires_at>?', sha(t), Date.now()) || null;
};
const setCookie = (res, value, maxAge) => res.setHeader('Set-Cookie', `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`);

export function addUser(email, name, companyId, password) {
  if (!get('SELECT 1 x FROM companies WHERE id=?', companyId)) throw new Error('unknown company ' + companyId);
  run('INSERT INTO users(email,name,password,company_id,created_at) VALUES(?,?,?,?,?)', email.trim().toLowerCase(), name, hashPassword(password), companyId, new Date().toISOString());
}

export const DEMO_PASSWORD = 'Demo@1234';
export function ensureDemoUsers() {
  if (get('SELECT 1 x FROM users')) return;
  addUser('admin@jkpaper.com', 'JK Paper Admin', 'c1', DEMO_PASSWORD);
  addUser('admin@xyzpaper.com', 'XYZ Paper Admin', 'c2', DEMO_PASSWORD);
  console.log(`Demo accounts created (password ${DEMO_PASSWORD}): admin@jkpaper.com, admin@xyzpaper.com`);
}

// ---- login / logout / me ----
export const authRouter = Router();
const fails = new Map(); // email -> { n, until }: 5 wrong passwords lock that email for a minute
authRouter.post('/login', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase(), password = String(req.body?.password || '');
  const f = fails.get(email);
  if (f && f.n >= 5 && Date.now() < f.until) return res.status(429).json({ error: 'Too many attempts, try again in a minute' });
  const u = get('SELECT * FROM users WHERE email=?', email);
  const ok = verify(password, u ? u.password : DUMMY) && u;
  if (!ok) { fails.set(email, { n: (f && Date.now() < f.until ? f.n : 0) + 1, until: Date.now() + 60000 }); return res.status(401).json({ error: 'Wrong email or password' }); }
  fails.delete(email);
  const token = crypto.randomBytes(32).toString('hex');
  run('DELETE FROM sessions WHERE expires_at<?', Date.now());
  run('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)', sha(token), u.id, Date.now() + TTL);
  setCookie(res, token, TTL / 1000);
  const c = get('SELECT name FROM companies WHERE id=?', u.company_id);
  res.json({ email: u.email, name: u.name, company: c.name, company_id: u.company_id });
});
authRouter.post('/logout', (req, res) => {
  const t = cookies(req)[COOKIE];
  if (t) run('DELETE FROM sessions WHERE token=?', sha(t));
  setCookie(res, '', 0);
  res.json({ ok: true });
});
authRouter.get('/me', (req, res) => {
  const u = sessionUser(req);
  if (!u) return res.status(401).json({ error: 'Not signed in' });
  res.json({ email: u.email, name: u.name, company: u.company, company_id: u.company_id });
});

// ---- guard for every other route ----
// Besides requiring a session this answers 404 for a truck, log or consignment that belongs to another company,
// so one company can never open another's data by guessing an id.
export function requireAuth(req, res, next) {
  const u = sessionUser(req);
  if (!u) return res.status(401).json({ error: 'Not signed in' });
  req.user = u; req.cid = u.company_id;

  let owner = null;
  const t = req.path.match(/^\/(?:trucks|reports)\/([^/]+)/);
  const l = req.path.match(/^\/logs\/(\d+)/);
  const c = req.path.match(/^\/consignments\/(\d+)/);
  if (t) owner = get('SELECT company_id FROM trucks WHERE id=?', t[1]);
  else if (l) owner = get('SELECT t.company_id FROM logs g JOIN trucks t ON t.id=g.truck_id WHERE g.id=?', l[1]);
  else if (c) owner = get('SELECT company_id FROM consignments WHERE id=?', c[1]);
  if (owner && owner.company_id !== req.cid) return res.status(404).json({ error: 'not found' });
  next();
}

// photos of a truck (/uploads/TRK-123.jpg, /uploads/TRK-123-annotated.jpg) are only served to the owning company
export function uploadGuard(req, res, next) {
  const u = sessionUser(req);
  if (!u) return res.status(401).end();
  const m = req.path.match(/^\/(TRK-\d+)/);
  if (m) { const t = get('SELECT company_id FROM trucks WHERE id=?', m[1]); if (!t || t.company_id !== u.company_id) return res.status(404).end(); }
  next();
}
