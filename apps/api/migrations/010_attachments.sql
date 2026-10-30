CREATE TABLE attachments (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,
 id TEXT NOT NULL UNIQUE,
 target_id TEXT NOT NULL REFERENCES objects(id),
 target_kind TEXT NOT NULL CHECK(target_kind IN ('requirement','task','bug')),
 sha256 TEXT NOT NULL CHECK(length(sha256)=64),
 size INTEGER NOT NULL CHECK(size>0),
 mime TEXT NOT NULL CHECK(mime IN ('image/png','image/jpeg','image/webp')),
 storage_key TEXT NOT NULL UNIQUE CHECK(length(storage_key)=64 AND storage_key NOT GLOB '*[^0-9a-f]*'),
 actor_id TEXT NOT NULL REFERENCES members(id),
 created_at TEXT NOT NULL
);
CREATE INDEX attachments_target ON attachments(target_id,seq);
CREATE TRIGGER attachments_target_kind BEFORE INSERT ON attachments WHEN NOT EXISTS(SELECT 1 FROM objects WHERE id=NEW.target_id AND kind=NEW.target_kind) BEGIN SELECT RAISE(ABORT,'invalid attachment target'); END;
CREATE TRIGGER attachments_no_update BEFORE UPDATE ON attachments BEGIN SELECT RAISE(ABORT,'attachments are immutable'); END;
CREATE TRIGGER attachments_no_delete BEFORE DELETE ON attachments BEGIN SELECT RAISE(ABORT,'attachments are immutable'); END;
