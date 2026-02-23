-- FILE: /db/migrations/0002_tables.sql (NEW)
-- Table configs are stored here so the DO can load immutable setup.
-- Rows are deleted when the table becomes empty (last connection leaves).

CREATE TABLE IF NOT EXISTS tables (
  table_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  creator_player_id TEXT NOT NULL,
  rules_json TEXT NOT NULL,
  spectator_chat_allowed INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'open'
);

CREATE INDEX IF NOT EXISTS idx_tables_creator ON tables(creator_player_id);
CREATE INDEX IF NOT EXISTS idx_tables_created_at ON tables(created_at);
