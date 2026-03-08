-- FILE: /db/migrations/0003_tables_hardening.sql (NEW)
-- Optional hardening migration.
-- This is NOT required to fix the original "no such table: tables" error.
-- That error is fixed by ensuring 0002_tables.sql has been applied to the
-- production D1 database bound to the deployed worker.
--
-- Use this migration only to add a useful status index and normalize any
-- unexpected legacy/null status values.

UPDATE tables
SET status = 'open'
WHERE status IS NULL OR trim(status) = '';

CREATE INDEX IF NOT EXISTS idx_tables_status ON tables(status);
