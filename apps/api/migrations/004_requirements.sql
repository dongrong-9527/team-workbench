CREATE TABLE requirement_revisions (
 requirement_id TEXT NOT NULL REFERENCES objects(id), revision INTEGER NOT NULL CHECK(revision>=1),
 snapshot TEXT NOT NULL CHECK(json_valid(snapshot)), affected_task_ids TEXT NOT NULL CHECK(json_valid(affected_task_ids)),
 affected_check_ids TEXT NOT NULL CHECK(json_valid(affected_check_ids)), reason TEXT NOT NULL, actor_id TEXT NOT NULL REFERENCES members(id), time TEXT NOT NULL,
 PRIMARY KEY(requirement_id,revision)
);
CREATE TRIGGER revisions_no_update BEFORE UPDATE ON requirement_revisions BEGIN SELECT RAISE(ABORT,'revisions are immutable'); END;
CREATE TRIGGER revisions_no_delete BEFORE DELETE ON requirement_revisions BEGIN SELECT RAISE(ABORT,'revisions are immutable'); END;
CREATE TABLE execution_participations (
 object_id TEXT NOT NULL REFERENCES objects(id), project_id TEXT NOT NULL REFERENCES projects(id), member_id TEXT NOT NULL REFERENCES members(id),
 requirement_id TEXT REFERENCES objects(id), role TEXT NOT NULL CHECK(role IN ('frontend','backend','test')), activity TEXT NOT NULL CHECK(activity IN ('development','repair')), recorded_at TEXT NOT NULL,
 PRIMARY KEY(object_id,member_id,role), FOREIGN KEY(project_id,object_id) REFERENCES objects(project_id,id)
);
CREATE TRIGGER participation_no_update BEFORE UPDATE ON execution_participations BEGIN SELECT RAISE(ABORT,'participation is immutable'); END;
CREATE TRIGGER participation_no_delete BEFORE DELETE ON execution_participations BEGIN SELECT RAISE(ABORT,'participation is immutable'); END;
CREATE TRIGGER participation_links BEFORE INSERT ON execution_participations WHEN
 NOT EXISTS(SELECT 1 FROM objects o WHERE o.id=NEW.object_id AND o.kind IN ('task','bug')) OR
 (NEW.requirement_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM objects o JOIN objects r ON r.id=NEW.requirement_id WHERE o.id=NEW.object_id AND r.kind='requirement' AND r.project_id=o.project_id))
 BEGIN SELECT RAISE(ABORT,'invalid participation links'); END;

CREATE TRIGGER revision_target BEFORE INSERT ON requirement_revisions WHEN NOT EXISTS(SELECT 1 FROM objects WHERE id=NEW.requirement_id AND kind='requirement') BEGIN SELECT RAISE(ABORT,'invalid revision target'); END;
CREATE TABLE requirement_scopes (
 requirement_id TEXT NOT NULL, revision INTEGER NOT NULL, version INTEGER NOT NULL,
 snapshot TEXT NOT NULL CHECK(json_valid(snapshot)), actor_id TEXT NOT NULL REFERENCES members(id), time TEXT NOT NULL,
 PRIMARY KEY(requirement_id,version), FOREIGN KEY(requirement_id,revision) REFERENCES requirement_revisions(requirement_id,revision)
);
CREATE TRIGGER scope_no_update BEFORE UPDATE ON requirement_scopes BEGIN SELECT RAISE(ABORT,'scope snapshots are immutable'); END;
CREATE TRIGGER scope_no_delete BEFORE DELETE ON requirement_scopes BEGIN SELECT RAISE(ABORT,'scope snapshots are immutable'); END;
