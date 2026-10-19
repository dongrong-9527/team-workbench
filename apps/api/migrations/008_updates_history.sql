CREATE TABLE updates (
 id TEXT PRIMARY KEY, logical_id TEXT NOT NULL REFERENCES updates(id), version INTEGER NOT NULL CHECK(version>=1),
 author_id TEXT NOT NULL REFERENCES members(id), project_id TEXT NOT NULL REFERENCES projects(id),
 target_kind TEXT NOT NULL CHECK(target_kind IN ('requirement','task','bug')), target_id TEXT NOT NULL,
 work_date TEXT NOT NULL, recorded_seq INTEGER NOT NULL UNIQUE REFERENCES events(seq),
 corrects_id TEXT UNIQUE REFERENCES updates(id), record TEXT NOT NULL CHECK(json_valid(record)),
 UNIQUE(logical_id,version), FOREIGN KEY(project_id,target_id) REFERENCES objects(project_id,id)
);
CREATE INDEX updates_logical_seq ON updates(logical_id,recorded_seq);
CREATE INDEX updates_author_seq ON updates(author_id,recorded_seq);
CREATE INDEX events_target_seq ON events(target_kind,target_id,seq);
CREATE TRIGGER updates_no_update BEFORE UPDATE ON updates BEGIN SELECT RAISE(ABORT,'updates are immutable'); END;
CREATE TRIGGER updates_no_delete BEFORE DELETE ON updates BEGIN SELECT RAISE(ABORT,'updates are immutable'); END;
CREATE TRIGGER updates_links BEFORE INSERT ON updates WHEN
 NOT EXISTS(SELECT 1 FROM objects WHERE id=NEW.target_id AND kind=NEW.target_kind) OR
 (NEW.corrects_id IS NULL AND (NEW.logical_id<>NEW.id OR NEW.version<>1)) OR
 (NEW.corrects_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM updates WHERE id=NEW.corrects_id AND logical_id=NEW.logical_id AND author_id=NEW.author_id AND target_id=NEW.target_id AND target_kind=NEW.target_kind AND version=NEW.version-1))
 BEGIN SELECT RAISE(ABORT,'invalid update links'); END;
