// Policy packs: Safety Simplified sends a client their own signing link, the client signs once,
// and the signed PDF comes back here (and on to Google Drive when the Google receiver is connected).
// Variables: GOOGLE_RECEIVER_URL and GOOGLE_RECEIVER_SECRET (the Apps Script web app that emails the client
// from Hannah's account and files signed packs in Drive), optional PUBLIC_URL (address used in signing links).
const express = require('express');
const crypto = require('crypto');
const path = require('path');

const RECEIVER = process.env.GOOGLE_RECEIVER_URL || '';
const RECEIVER_SECRET = process.env.GOOGLE_RECEIVER_SECRET || '';
const PACK_NAME = 'Business Policy Pack';
const clean = s => String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
const two = n => String(n).padStart(2, '0');
const ukDate = d => `${two(d.getDate())}-${two(d.getMonth() + 1)}-${d.getFullYear()}`;

async function google(payload) {
  if (!RECEIVER) return { ok: false, off: true };
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 45000);
  try {
    const r = await fetch(RECEIVER, { method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...payload, secret: RECEIVER_SECRET }), signal: ctl.signal });
    const j = await r.json().catch(() => null);
    return j && j.ok ? j : { ok: false, error: (j && j.error) || `Google receiver answered ${r.status}` };
  } catch (e) { return { ok: false, error: e.name === 'AbortError' ? 'Google receiver did not answer in time' : 'Could not reach the Google receiver' }; }
  finally { clearTimeout(t); }
}

function emailText(pack, link) {
  const first = pack.signer.split(' ')[0] || 'there';
  return `Hi ${first},\n\nYour company policies for ${pack.company} are ready to sign.\n\nPlease read them and sign using this link. It takes a few minutes and works on a phone:\n\n${link}\n\nOnce you sign, a copy comes straight back to us, so there is nothing to send.\n\nThanks,\nHannah\nSafety Simplified Ltd`;
}

module.exports = function packs(app, { db, user, needUser, wrap }) {
  const base = req => (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
  const library = async version => (await db.q(version
    ? "SELECT version, body FROM library_versions WHERE name = 'pack' AND version = $1"
    : "SELECT version, body FROM library_versions WHERE name = 'pack' ORDER BY version DESC LIMIT 1", version ? [version] : [])).rows[0];
  const LIST = 'id, ref, token, company, signer, role, email, policy_keys, library_version, status, emailed, sent_by, sent_at, signed_name, signed_role, signed_at, pdf_name, drive_url, drive_error';

  // ---- Safety Simplified side (logged in) ----
  app.get('/api/packs', needUser, wrap(async (req, res) => {
    const lib = await library();
    const rows = (await db.q(`SELECT ${LIST} FROM policy_packs ORDER BY sent_at DESC`)).rows;
    res.json({
      google: !!RECEIVER, version: lib ? lib.version : null,
      policies: lib ? lib.body.policies.map(p => ({ id: p.id, title: p.title })) : [],
      packs: rows.map(r => ({ ...r, link: `${base(req)}/sign/${r.token}`, token: undefined }))
    });
  }));

  app.post('/api/packs', needUser, wrap(async (req, res) => {
    const b = req.body || {};
    const company = String(b.company || '').trim(), signer = String(b.signer || '').trim(), role = String(b.role || '').trim() || 'Director';
    const email = String(b.email || '').trim(), wantEmail = !b.noEmail;
    if (!company) return res.status(400).json({ error: 'Enter the company name.' });
    if (!signer) return res.status(400).json({ error: 'Enter the name of the person signing.' });
    if (wantEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter their email address, or choose to just get the link.' });
    const lib = await library();
    if (!lib) return res.status(503).json({ error: 'The pack library is not published yet.' });
    const all = lib.body.policies.map(p => p.id);
    const keys = Array.isArray(b.keys) && b.keys.length ? all.filter(k => b.keys.includes(k)) : all;
    if (!keys.length) return res.status(400).json({ error: 'Tick at least one policy.' });
    const token = crypto.randomBytes(24).toString('base64url');
    const ref = crypto.randomBytes(5).toString('hex').toUpperCase();
    const row = (await db.q(`INSERT INTO policy_packs (token, ref, company, signer, role, email, policy_keys, library_version, sent_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [token, ref, company, signer, role, email || null, JSON.stringify(keys), lib.version, user(req).name])).rows[0];
    const link = `${base(req)}/sign/${token}`;
    const pack = { company, signer };
    let emailed = false, emailError = null;
    if (wantEmail) {
      const g = await google({ action: 'email', to: email, company, name: signer, link });
      emailed = !!g.ok; emailError = g.ok ? null : (g.off ? 'Emailing is not connected yet, so send this one yourself.' : g.error);
      if (emailed) await db.q('UPDATE policy_packs SET emailed = TRUE WHERE id = $1', [row.id]);
    }
    res.json({ id: row.id, link, emailed, emailError, emailText: emailText(pack, link) });
  }));

  app.get('/api/packs/:id/pdf', needUser, wrap(async (req, res) => {
    const r = (await db.q('SELECT pdf, pdf_name FROM policy_packs WHERE id = $1', [Number(req.params.id) || 0])).rows[0];
    if (!r || !r.pdf) return res.status(404).json({ error: 'No signed copy yet.' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(r.pdf_name || 'signed-policies.pdf')}"`);
    res.send(r.pdf);
  }));

  app.post('/api/packs/:id/refile', needUser, wrap(async (req, res) => {
    const r = (await db.q('SELECT id, ref, company, signed_name, signed_role, pdf, pdf_name FROM policy_packs WHERE id = $1', [Number(req.params.id) || 0])).rows[0];
    if (!r || !r.pdf) return res.status(404).json({ error: 'No signed copy yet.' });
    const g = await google({ action: 'file', company: r.company, filename: r.pdf_name, pdf: r.pdf.toString('base64'), name: r.signed_name, role: r.signed_role, ref: r.ref });
    await db.q('UPDATE policy_packs SET drive_url = $2, drive_error = $3 WHERE id = $1', [r.id, g.ok ? g.url : null, g.ok ? null : (g.off ? 'Drive is not connected yet' : g.error)]);
    if (!g.ok) return res.status(502).json({ error: g.off ? 'Drive is not connected yet.' : g.error });
    res.json({ ok: true, url: g.url });
  }));

  app.post('/api/packs/:id/delete', needUser, wrap(async (req, res) => {
    const r = await db.q("DELETE FROM policy_packs WHERE id = $1 AND status <> 'signed'", [Number(req.params.id) || 0]);
    if (!r.rowCount) return res.status(400).json({ error: 'Signed packs are kept.' });
    res.json({ ok: true });
  }));

  // ---- the client's side: one unguessable link, their own pack only ----
  app.get('/sign/:token', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'sign.html')));

  app.get('/api/sign/:token', wrap(async (req, res) => {
    const p = (await db.q('SELECT ref, company, signer, role, policy_keys, library_version, status, signed_at FROM policy_packs WHERE token = $1', [req.params.token])).rows[0];
    if (!p) return res.status(404).json({ error: 'This link is not recognised.' });
    if (p.status === 'signed') return res.json({ signed: true, company: p.company, signed_at: p.signed_at });
    const lib = await library(p.library_version);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ref: p.ref, company: p.company, signer: p.signer, role: p.role, version: lib.version, packName: PACK_NAME,
      policies: lib.body.policies.filter(x => p.policy_keys.includes(x.id)) });
  }));

  app.post('/api/sign/:token', express.json({ limit: '12mb' }), wrap(async (req, res) => {
    const b = req.body || {};
    const name = String(b.name || '').trim().slice(0, 120), role = String(b.role || '').trim().slice(0, 120);
    if (!name || !role || typeof b.pdf !== 'string') return res.status(400).json({ error: 'Something is missing.' });
    const pdf = Buffer.from(b.pdf, 'base64');
    if (pdf.length < 1000 || pdf.subarray(0, 4).toString() !== '%PDF') return res.status(400).json({ error: 'That is not a signed copy.' });
    const p = (await db.q('SELECT id, ref, company, status FROM policy_packs WHERE token = $1', [req.params.token])).rows[0];
    if (!p) return res.status(404).json({ error: 'This link is not recognised.' });
    if (p.status === 'signed') return res.status(409).json({ error: 'These policies have already been signed.' });
    const filename = `${clean(p.company)} - ${PACK_NAME} - signed ${ukDate(new Date())}.pdf`;
    await db.q("UPDATE policy_packs SET status = 'signed', signed_name = $2, signed_role = $3, signed_at = NOW(), pdf = $4, pdf_name = $5 WHERE id = $1", [p.id, name, role, pdf, filename]);
    // The client is finished at this point. Filing in Drive happens behind them, and can be retried from Tresor.
    res.json({ ok: true });
    google({ action: 'file', company: p.company, filename, pdf: b.pdf, name, role, ref: p.ref })
      .then(g => db.q('UPDATE policy_packs SET drive_url = $2, drive_error = $3 WHERE id = $1', [p.id, g.ok ? g.url : null, g.ok ? null : (g.off ? 'Drive is not connected yet' : g.error)]))
      .catch(e => console.error('Drive filing failed:', e.message));
  }));
};
