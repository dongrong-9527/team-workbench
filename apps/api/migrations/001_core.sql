CREATE TABLE members (id TEXT PRIMARY KEY, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), is_admin INTEGER NOT NULL DEFAULT 0 CHECK(is_admin IN (0,1)));
CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)));
CREATE TABLE roles (project_id TEXT NOT NULL REFERENCES projects(id), member_id TEXT NOT NULL REFERENCES members(id), role TEXT NOT NULL CHECK(role IN ('product','frontend','backend','test')), PRIMARY KEY(project_id,member_id,role));
CREATE TABLE objects (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('requirement','task','bug')), project_id TEXT NOT NULL REFERENCES projects(id), version INTEGER NOT NULL CHECK(version>=1), current TEXT NOT NULL CHECK(json_valid(current) AND json_type(current)='object'), UNIQUE(project_id,id));
CREATE TABLE events (seq INTEGER PRIMARY KEY AUTOINCREMENT, time TEXT NOT NULL CHECK(time GLOB '????-??-??T??:??:??.???Z'), action TEXT NOT NULL, actor_id TEXT NOT NULL REFERENCES members(id), target_kind TEXT NOT NULL CHECK(target_kind IN ('requirement','task','bug','member')), target_id TEXT NOT NULL, before_snapshot TEXT CHECK(before_snapshot IS NULL OR json_valid(before_snapshot)), after_snapshot TEXT CHECK(after_snapshot IS NULL OR json_valid(after_snapshot)));
CREATE TRIGGER events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'events are append-only'); END;
CREATE TRIGGER events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'events are append-only'); END;
CREATE TABLE idempotency (actor_id TEXT NOT NULL REFERENCES members(id), request_id TEXT NOT NULL, route TEXT NOT NULL, body_hash TEXT NOT NULL, response TEXT NOT NULL CHECK(json_valid(response)), PRIMARY KEY(actor_id,request_id));

CREATE TRIGGER objects_version BEFORE UPDATE ON objects WHEN NEW.version != OLD.version+1 BEGIN SELECT RAISE(ABORT,'version must increment once'); END;
CREATE TRIGGER events_target BEFORE INSERT ON events WHEN
 (NEW.target_kind='member' AND NOT EXISTS(SELECT 1 FROM members WHERE id=NEW.target_id)) OR
 (NEW.target_kind!='member' AND NOT EXISTS(SELECT 1 FROM objects WHERE id=NEW.target_id AND kind=NEW.target_kind))
 BEGIN SELECT RAISE(ABORT,'event target does not exist'); END;
