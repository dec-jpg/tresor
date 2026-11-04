// Tresor: Safety Simplified's own side. One page showing every client portal, read from each portal's Tresor feed.
// Variables: TRESOR_KEY (same key as on the portals), TRESOR_PASSWORD, TRESOR_USERS ("dec@...:Dec;frank@...:Frank"),
// SESSION_SECRET (any long string), optional PORT. Clients are listed in clients.json.
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const db = require('./lib/db');

const clients = JSON.parse(fs.readFileSync(process.env.CLIENTS_FILE || path.join(__dirname, 'clients.json'), 'utf8'));
const KEY = process.env.TRESOR_KEY || '';
const PASSWORD = process.env.TRESOR_PASSWORD || '';
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const USERS = Object.fromEntries((process.env.TRESOR_USERS || 'dec@safety-simplified.com:Dec').split(';').map(s => s.trim()).filter(Boolean)
  .map(s => { const [email, name] = s.split(':'); return [email.trim().toLowerCase(), (name || email).trim()]; }));

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json());

// ---- sessions: a signed cookie, nothing stored ----
const sign = v => v + '.' + crypto.createHmac('sha256', SECRET).update(v).digest('base64url');
const unsign = s => { if (!s) return null; const i = s.lastIndexOf('.'); if (i < 0) return null; const v = s.slice(0, i); return sign(v) === s ? v : null; };
const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(p => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
const user = req => { const e = unsign(cookies(req).tresor); return e && USERS[e] ? { email: e, name: USERS[e] } : null; };
const safeEq = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

app.get('/api/me', (req, res) => res.json({ user: user(req) }));
app.post('/api/login', (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase(), pw = String((req.body || {}).password || '');
  if (!USERS[email] || !PASSWORD || !safeEq(pw, PASSWORD)) return res.status(401).json({ error: 'Email or password not right.' });
  res.setHeader('Set-Cookie', `tresor=${encodeURIComponent(sign(email))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
  res.json({ user: { email, name: USERS[email] } });
});
app.post('/api/logout', (req, res) => { res.setHeader('Set-Cookie', 'tresor=; Path=/; Max-Age=0'); res.json({ ok: true }); });

// ---- the overview: every portal's feed, fetched side by side, cached for a minute ----
let cache = { at: 0, data: null };
async function feed(c) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(c.url + '/api/tresor/summary', { headers: { 'x-tresor-key': KEY }, signal: ctl.signal });
    if (!r.ok) return { ...c, ok: false, error: `Portal answered ${r.status}` };
    return { ...c, ok: true, ...(await r.json()) };
  } catch (e) { return { ...c, ok: false, error: e.name === 'AbortError' ? 'Portal did not answer in time' : 'Could not reach the portal' }; }
  finally { clearTimeout(t); }
}
app.get('/api/overview', async (req, res) => {
  if (!user(req)) return res.status(401).json({ error: 'Log in first.' });
  if (req.query.fresh || Date.now() - cache.at > 60000) cache = { at: Date.now(), data: await Promise.all(clients.map(feed)) };
  res.json({ clients: cache.data, at: new Date(cache.at).toISOString() });
});

// ---- libraries: what Safety Simplified keeps once for every client ----
const needUser = (req, res, next) => (user(req) ? next() : res.status(401).json({ error: 'Log in first.' }));
const needKey = (req, res, next) => { const g = req.get('x-tresor-key') || ''; if (!KEY || g.length !== KEY.length || !safeEq(g, KEY)) return res.status(401).json({ error: 'Not authorised.' }); next(); };
const wrap = fn => (req, res) => fn(req, res).catch(e => res.status(e.status || 500).json({ error: e.message }));

// Portals pull the current published version with this (keyed, no login).
app.get('/api/library/:name', needKey, wrap(async (req, res) => {
  const v = (await db.q('SELECT version, body, note, resign, published_at FROM library_versions WHERE name = $1 ORDER BY version DESC LIMIT 1', [req.params.name])).rows[0];
  if (!v) return res.status(404).json({ error: 'No published version.' });
  res.json(v);
}));
// The editor works on the draft; publishing snapshots it as the next version.
app.get('/api/libraries/:name', needUser, wrap(async (req, res) => {
  const draft = (await db.q('SELECT body, updated_by, updated_at FROM library_drafts WHERE name = $1', [req.params.name])).rows[0] || null;
  const versions = (await db.q('SELECT version, note, resign, published_by, published_at FROM library_versions WHERE name = $1 ORDER BY version DESC', [req.params.name])).rows;
  res.json({ draft, versions, enabled: db.enabled });
}));
app.put('/api/libraries/:name', needUser, wrap(async (req, res) => {
  const body = (req.body || {}).body;
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Nothing to save.' });
  await db.q('INSERT INTO library_drafts (name, body, updated_by, updated_at) VALUES ($1,$2,$3,NOW()) ON CONFLICT (name) DO UPDATE SET body = EXCLUDED.body, updated_by = EXCLUDED.updated_by, updated_at = NOW()', [req.params.name, JSON.stringify(body), user(req).name]);
  res.json({ ok: true });
}));
app.post('/api/libraries/:name/publish', needUser, wrap(async (req, res) => {
  const draft = (await db.q('SELECT body FROM library_drafts WHERE name = $1', [req.params.name])).rows[0];
  if (!draft) return res.status(400).json({ error: 'Save a draft first.' });
  const prev = (await db.q('SELECT version FROM library_versions WHERE name = $1 ORDER BY version DESC LIMIT 1', [req.params.name])).rows[0];
  const version = prev ? prev.version + 1 : 1;
  const b = req.body || {};
  await db.q('INSERT INTO library_versions (name, version, body, note, resign, published_by) VALUES ($1,$2,$3,$4,$5,$6)', [req.params.name, version, JSON.stringify(draft.body), String(b.note || '').slice(0, 300), b.resign !== false, user(req).name]);
  cache = { at: 0, data: null };
  res.json({ version });
}));

app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html', maxAge: 0 }));
app.get('/healthz', (req, res) => res.json({ ok: true }));
db.migrate().then(() => app.listen(process.env.PORT || 3000, () => console.log('Tresor listening on', process.env.PORT || 3000))).catch(e => { console.error('Startup failed:', e); process.exit(1); });
