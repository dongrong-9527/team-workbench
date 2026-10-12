ALTER TABLE members ADD COLUMN login TEXT;
ALTER TABLE members ADD COLUMN password_hash TEXT;
ALTER TABLE members ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1);
CREATE UNIQUE INDEX members_login ON members(login);
CREATE TABLE sessions (
 token_digest TEXT PRIMARY KEY,
 member_id TEXT NOT NULL REFERENCES members(id),
 csrf_digest TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 last_seen INTEGER NOT NULL
);
CREATE INDEX sessions_member ON sessions(member_id);
CREATE TABLE auth_tickets (
 token_digest TEXT PRIMARY KEY,
 member_id TEXT NOT NULL REFERENCES members(id),
 kind TEXT NOT NULL CHECK(kind IN ('activate','reset')),
 expires_at INTEGER NOT NULL
);
CREATE INDEX auth_tickets_member ON auth_tickets(member_id);
CREATE TABLE auth_failures (
 bucket TEXT PRIMARY KEY,
 failures INTEGER NOT NULL,
 started_at INTEGER NOT NULL
);
