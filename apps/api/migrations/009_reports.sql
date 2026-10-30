-- Report artifacts audit themselves. Business events and their referenced schema stay unchanged.
CREATE TABLE report_versions (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,
 id TEXT NOT NULL UNIQUE,
 series_id TEXT NOT NULL REFERENCES report_versions(id),
 version INTEGER NOT NULL CHECK(version>=1),
 creator_id TEXT NOT NULL REFERENCES members(id),
 record TEXT NOT NULL CHECK(json_valid(record)),
 source_snapshot TEXT NOT NULL CHECK(json_valid(source_snapshot)),
 UNIQUE(series_id,version)
);
CREATE INDEX report_series_seq ON report_versions(series_id,seq);
CREATE TRIGGER reports_no_update BEFORE UPDATE ON report_versions BEGIN SELECT RAISE(ABORT,'reports are immutable'); END;
CREATE TRIGGER reports_no_delete BEFORE DELETE ON report_versions BEGIN SELECT RAISE(ABORT,'reports are immutable'); END;
CREATE TRIGGER reports_chain BEFORE INSERT ON report_versions WHEN
 (NEW.version=1 AND NEW.series_id<>NEW.id) OR
 (NEW.version>1 AND NOT EXISTS(SELECT 1 FROM report_versions WHERE series_id=NEW.series_id AND version=NEW.version-1 AND creator_id=NEW.creator_id))
 BEGIN SELECT RAISE(ABORT,'invalid report version chain'); END;
