-- Optional journal sync for tao.tensor.group. A reader turns it on with a passkey.
-- No email, no name, no IP. The journal is stored as the same JSON as an export file,
-- without lastExportAt.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,          -- base64url of the WebAuthn user handle
  label TEXT NOT NULL,          -- "Tao journal · 25 Nov 2026", also the passkey's name
  created INTEGER NOT NULL      -- ms
);
CREATE INDEX IF NOT EXISTS users_created ON users(created);
CREATE TABLE IF NOT EXISTS credentials (
  id TEXT PRIMARY KEY,          -- base64url credential id
  user_id TEXT NOT NULL,
  public_key TEXT NOT NULL,     -- base64url COSE key
  counter INTEGER NOT NULL,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS credentials_user ON credentials(user_id);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,  -- SHA-256 of the cookie value
  user_id TEXT NOT NULL,
  expires INTEGER NOT NULL,
  refreshed INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires);
CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  kind TEXT NOT NULL,           -- 'reg' | 'auth'
  user_id TEXT,                 -- set for 'reg': the new account's id
  label TEXT,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS challenges_expires ON challenges(expires);
CREATE TABLE IF NOT EXISTS journals (
  user_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  rev INTEGER NOT NULL,
  updated INTEGER NOT NULL
);
