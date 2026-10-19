ALTER TABLE projects ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1);
ALTER TABLE projects ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE roles ADD COLUMN lead INTEGER NOT NULL DEFAULT 0 CHECK(lead IN (0,1));
DROP TRIGGER events_no_update;
DROP TRIGGER events_no_delete;
DROP TRIGGER events_target;
ALTER TABLE events RENAME TO events_old;
CREATE TABLE events (seq INTEGER PRIMARY KEY AUTOINCREMENT, time TEXT NOT NULL CHECK(time GLOB '????-??-??T??:??:??.???Z'), action TEXT NOT NULL, actor_id TEXT NOT NULL REFERENCES members(id), target_kind TEXT NOT NULL CHECK(target_kind IN ('requirement','task','bug','member','project')), target_id TEXT NOT NULL, before_snapshot TEXT CHECK(before_snapshot IS NULL OR json_valid(before_snapshot)), after_snapshot TEXT CHECK(after_snapshot IS NULL OR json_valid(after_snapshot)));
INSERT INTO events SELECT * FROM events_old;
DROP TABLE events_old;
CREATE TRIGGER events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'events are append-only'); END;
CREATE TRIGGER events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'events are append-only'); END;
CREATE TRIGGER events_target BEFORE INSERT ON events WHEN
 (NEW.target_kind='member' AND NOT EXISTS(SELECT 1 FROM members WHERE id=NEW.target_id)) OR
 (NEW.target_kind='project' AND NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.target_id)) OR
 (NEW.target_kind IN ('requirement','task','bug') AND NOT EXISTS(SELECT 1 FROM objects WHERE id=NEW.target_id AND kind=NEW.target_kind))
 BEGIN SELECT RAISE(ABORT,'event target does not exist'); END;
CREATE TRIGGER projects_version BEFORE UPDATE ON projects WHEN NEW.version != OLD.version+1 BEGIN SELECT RAISE(ABORT,'version must increment once'); END;
