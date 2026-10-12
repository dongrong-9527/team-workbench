CREATE TABLE acceptance_records (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), requirement_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>=1), target_version TEXT NOT NULL, acceptor_id TEXT NOT NULL REFERENCES members(id),
 recorded_seq INTEGER NOT NULL UNIQUE REFERENCES events(seq), record TEXT NOT NULL CHECK(json_valid(record)),
 FOREIGN KEY(project_id,requirement_id) REFERENCES objects(project_id,id)
);
CREATE TABLE bug_waivers (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), requirement_id TEXT NOT NULL, bug_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>=1), bug_version INTEGER NOT NULL CHECK(bug_version>=1),
 recorded_seq INTEGER NOT NULL UNIQUE REFERENCES events(seq), record TEXT NOT NULL CHECK(json_valid(record)),
 UNIQUE(requirement_id,bug_id,revision,bug_version),
 FOREIGN KEY(project_id,requirement_id) REFERENCES objects(project_id,id), FOREIGN KEY(project_id,bug_id) REFERENCES objects(project_id,id)
);
CREATE TRIGGER acceptance_no_update BEFORE UPDATE ON acceptance_records BEGIN SELECT RAISE(ABORT,'acceptance immutable'); END;
CREATE TRIGGER acceptance_no_delete BEFORE DELETE ON acceptance_records BEGIN SELECT RAISE(ABORT,'acceptance immutable'); END;
CREATE TRIGGER waivers_no_update BEFORE UPDATE ON bug_waivers BEGIN SELECT RAISE(ABORT,'waivers immutable'); END;
CREATE TRIGGER waivers_no_delete BEFORE DELETE ON bug_waivers BEGIN SELECT RAISE(ABORT,'waivers immutable'); END;
CREATE TRIGGER acceptance_links BEFORE INSERT ON acceptance_records WHEN NOT EXISTS(SELECT 1 FROM objects WHERE id=NEW.requirement_id AND kind='requirement') BEGIN SELECT RAISE(ABORT,'invalid acceptance link'); END;
CREATE TRIGGER waiver_links BEFORE INSERT ON bug_waivers WHEN NOT EXISTS(SELECT 1 FROM objects WHERE id=NEW.requirement_id AND kind='requirement') OR NOT EXISTS(SELECT 1 FROM objects WHERE id=NEW.bug_id AND kind='bug') BEGIN SELECT RAISE(ABORT,'invalid waiver links'); END;
