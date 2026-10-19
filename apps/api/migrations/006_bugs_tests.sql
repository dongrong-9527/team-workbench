CREATE TABLE test_records (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), target_kind TEXT NOT NULL CHECK(target_kind IN ('requirement','task','bug')), target_id TEXT NOT NULL,
 requirement_id TEXT REFERENCES objects(id), revision INTEGER CHECK(revision>=1), target_version TEXT NOT NULL, tester_id TEXT NOT NULL REFERENCES members(id), recorded_seq INTEGER NOT NULL UNIQUE REFERENCES events(seq), record TEXT NOT NULL CHECK(json_valid(record)),
 FOREIGN KEY(project_id,target_id) REFERENCES objects(project_id,id), FOREIGN KEY(project_id,requirement_id) REFERENCES objects(project_id,id)
);
CREATE INDEX tests_target ON test_records(target_id,revision,target_version,recorded_seq);
CREATE TRIGGER tests_no_update BEFORE UPDATE ON test_records BEGIN SELECT RAISE(ABORT,'test records are immutable'); END;
CREATE TRIGGER tests_no_delete BEFORE DELETE ON test_records BEGIN SELECT RAISE(ABORT,'test records are immutable'); END;
CREATE TRIGGER tests_links BEFORE INSERT ON test_records WHEN
 NOT EXISTS(SELECT 1 FROM objects WHERE id=NEW.target_id AND kind=NEW.target_kind) OR
 (NEW.requirement_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM objects WHERE id=NEW.requirement_id AND kind='requirement'))
 BEGIN SELECT RAISE(ABORT,'invalid test links'); END;
CREATE TRIGGER bug_links_insert BEFORE INSERT ON objects WHEN NEW.kind='bug' AND (
 (json_extract(NEW.current,'$.requirementId') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM objects WHERE id=json_extract(NEW.current,'$.requirementId') AND kind='requirement' AND project_id=NEW.project_id)) OR
 (json_extract(NEW.current,'$.taskId') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM objects WHERE id=json_extract(NEW.current,'$.taskId') AND kind='task' AND project_id=NEW.project_id))
) BEGIN SELECT RAISE(ABORT,'invalid bug links'); END;
CREATE TRIGGER bug_links_update BEFORE UPDATE ON objects WHEN NEW.kind='bug' AND (
 (json_extract(NEW.current,'$.requirementId') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM objects WHERE id=json_extract(NEW.current,'$.requirementId') AND kind='requirement' AND project_id=NEW.project_id)) OR
 (json_extract(NEW.current,'$.taskId') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM objects WHERE id=json_extract(NEW.current,'$.taskId') AND kind='task' AND project_id=NEW.project_id))
) BEGIN SELECT RAISE(ABORT,'invalid bug links'); END;
