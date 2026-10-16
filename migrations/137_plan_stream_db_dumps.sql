-- Stream MySQL/PostgreSQL dumps straight into the archive instead of writing
-- them to the client's disk first (#540). Per plan, off by default.
ALTER TABLE backup_plans ADD COLUMN stream_db_dumps TINYINT(1) NOT NULL DEFAULT 0 AFTER snapshot;
