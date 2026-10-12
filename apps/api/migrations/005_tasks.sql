CREATE TABLE task_dependencies (
 project_id TEXT NOT NULL, task_id TEXT NOT NULL, dependency_id TEXT NOT NULL,
 PRIMARY KEY(task_id,dependency_id), CHECK(task_id<>dependency_id),
 FOREIGN KEY(project_id,task_id) REFERENCES objects(project_id,id), FOREIGN KEY(project_id,dependency_id) REFERENCES objects(project_id,id)
);
CREATE TRIGGER dependency_kinds BEFORE INSERT ON task_dependencies WHEN NOT EXISTS(SELECT 1 FROM objects WHERE id=NEW.task_id AND kind='task') OR NOT EXISTS(SELECT 1 FROM objects WHERE id=NEW.dependency_id AND kind='task') BEGIN SELECT RAISE(ABORT,'invalid task dependency'); END;
CREATE TRIGGER task_parent_insert BEFORE INSERT ON objects WHEN NEW.kind='task' AND json_extract(NEW.current,'$.requirementId') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM objects WHERE id=json_extract(NEW.current,'$.requirementId') AND project_id=NEW.project_id AND kind='requirement') BEGIN SELECT RAISE(ABORT,'invalid task parent'); END;
CREATE TRIGGER task_parent_update BEFORE UPDATE ON objects WHEN NEW.kind='task' AND json_extract(NEW.current,'$.requirementId') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM objects WHERE id=json_extract(NEW.current,'$.requirementId') AND project_id=NEW.project_id AND kind='requirement') BEGIN SELECT RAISE(ABORT,'invalid task parent'); END;
CREATE TABLE task_work (
 id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES objects(id),project_id TEXT NOT NULL REFERENCES projects(id),requirement_id TEXT REFERENCES objects(id),actor_id TEXT NOT NULL REFERENCES members(id),role TEXT NOT NULL,activity TEXT NOT NULL CHECK(activity IN ('development','testing','other')),action TEXT NOT NULL,evidence TEXT NOT NULL CHECK(json_valid(evidence)),time TEXT NOT NULL,
 FOREIGN KEY(project_id,task_id) REFERENCES objects(project_id,id), FOREIGN KEY(project_id,requirement_id) REFERENCES objects(project_id,id)
);
CREATE TABLE task_checks (
 id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES objects(id),project_id TEXT NOT NULL REFERENCES projects(id),requirement_id TEXT REFERENCES objects(id),revision INTEGER,task_version INTEGER NOT NULL,reviewer_id TEXT NOT NULL REFERENCES members(id),result TEXT NOT NULL CHECK(result IN ('pass','fail')),environment TEXT NOT NULL,evidence TEXT NOT NULL CHECK(json_valid(evidence)),self_test INTEGER NOT NULL CHECK(self_test IN (0,1)),time TEXT NOT NULL,
 FOREIGN KEY(project_id,task_id) REFERENCES objects(project_id,id), FOREIGN KEY(project_id,requirement_id) REFERENCES objects(project_id,id)
);
CREATE TABLE task_parallel_approvals (
 id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES objects(id),actor_id TEXT NOT NULL REFERENCES members(id),reason TEXT NOT NULL,snapshot TEXT NOT NULL CHECK(json_valid(snapshot)),time TEXT NOT NULL
);
CREATE TRIGGER work_no_update BEFORE UPDATE ON task_work BEGIN SELECT RAISE(ABORT,'work is immutable'); END;
CREATE TRIGGER work_no_delete BEFORE DELETE ON task_work BEGIN SELECT RAISE(ABORT,'work is immutable'); END;
CREATE TRIGGER checks_no_update BEFORE UPDATE ON task_checks BEGIN SELECT RAISE(ABORT,'checks are immutable'); END;
CREATE TRIGGER checks_no_delete BEFORE DELETE ON task_checks BEGIN SELECT RAISE(ABORT,'checks are immutable'); END;
CREATE TRIGGER parallel_no_update BEFORE UPDATE ON task_parallel_approvals BEGIN SELECT RAISE(ABORT,'approval is immutable'); END;
CREATE TRIGGER parallel_no_delete BEFORE DELETE ON task_parallel_approvals BEGIN SELECT RAISE(ABORT,'approval is immutable'); END;

CREATE TRIGGER work_links BEFORE INSERT ON task_work WHEN NOT EXISTS(SELECT 1 FROM objects WHERE id=NEW.task_id AND kind='task') OR (NEW.requirement_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM objects WHERE id=NEW.requirement_id AND kind='requirement')) BEGIN SELECT RAISE(ABORT,'invalid task work links'); END;
CREATE TRIGGER check_links BEFORE INSERT ON task_checks WHEN NOT EXISTS(SELECT 1 FROM objects WHERE id=NEW.task_id AND kind='task') OR (NEW.requirement_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM objects WHERE id=NEW.requirement_id AND kind='requirement')) BEGIN SELECT RAISE(ABORT,'invalid task check links'); END;
