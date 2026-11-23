// Tresor's own database: the libraries Safety Simplified keeps for every client (policies for now).
// Without DATABASE_URL the library side is off and the board still works.
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const url = process.env.DATABASE_URL || '';
const pool = url ? new Pool({ connectionString: url, ssl: /sslmode=require/.test(url) || /proxy\.rlwy\.net/.test(url) ? { rejectUnauthorized: false } : false, max: 5 }) : null;
const q = (text, params) => { if (!pool) throw Object.assign(new Error('Tresor has no database yet (DATABASE_URL).'), { status: 503 }); return pool.query(text, params); };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS library_drafts (
  name TEXT PRIMARY KEY,
  body JSONB NOT NULL,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS library_versions (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  body JSONB NOT NULL,
  note TEXT,
  resign BOOLEAN NOT NULL DEFAULT TRUE,
  published_by TEXT,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (name, version)
);
CREATE TABLE IF NOT EXISTS policy_packs (
  id SERIAL PRIMARY KEY,
  token TEXT UNIQUE NOT NULL,
  ref TEXT NOT NULL,
  company TEXT NOT NULL,
  signer TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'Director',
  email TEXT,
  policy_keys JSONB NOT NULL,
  library_version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent',
  emailed BOOLEAN NOT NULL DEFAULT FALSE,
  sent_by TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  signed_name TEXT,
  signed_role TEXT,
  signed_at TIMESTAMPTZ,
  pdf BYTEA,
  pdf_name TEXT,
  drive_url TEXT,
  drive_error TEXT
);`;

async function migrate() {
  if (!pool) return console.log('Tresor: no DATABASE_URL, libraries off');
  await pool.query(SCHEMA);
  // First boot: the policy library ships with the build and is published as version 1.
  if ((await pool.query("SELECT 1 FROM library_versions WHERE name = 'policies' LIMIT 1")).rows.length === 0) {
    const seed = JSON.parse(fs.readFileSync(path.join(__dirname, 'policies-seed.json'), 'utf8'));
    await pool.query("INSERT INTO library_drafts (name, body, updated_by) VALUES ('policies', $1, 'Safety Simplified') ON CONFLICT (name) DO NOTHING", [JSON.stringify(seed)]);
    await pool.query("INSERT INTO library_versions (name, version, body, note, published_by) VALUES ('policies', 1, $1, 'Safety Simplified policy library, 15 policies', 'Safety Simplified')", [JSON.stringify(seed)]);
  }
  // The signing pack for clients who are not on a portal: the 18-policy Business Policy Pack.
  if ((await pool.query("SELECT 1 FROM library_versions WHERE name = 'pack' LIMIT 1")).rows.length === 0) {
    const pack = JSON.parse(fs.readFileSync(path.join(__dirname, 'pack-seed.json'), 'utf8'));
    await pool.query("INSERT INTO library_versions (name, version, body, note, resign, published_by) VALUES ('pack', 1, $1, 'Business policy pack, 18 policies: the ECR pack wording with additions from the PandaDoc and DDG packs', FALSE, 'Safety Simplified')", [JSON.stringify(pack)]);
  }
}

module.exports = { pool, q, migrate, enabled: !!pool };
