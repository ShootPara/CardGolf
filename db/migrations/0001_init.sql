-- /db/migrations/0001_init.sql

CREATE TABLE IF NOT EXISTS players (
  player_id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  last_table_rules_json TEXT,
  wins_total INTEGER NOT NULL DEFAULT 0,
  losses_total INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS games (
  game_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL,
  mode TEXT NOT NULL,
  target_points INTEGER,
  rules_json TEXT NOT NULL,
  creator_player_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS game_players (
  game_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  final_score INTEGER NOT NULL,
  is_winner INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (game_id, player_id)
);

CREATE TABLE IF NOT EXISTS player_monthly_stats (
  player_id TEXT NOT NULL,
  year_month TEXT NOT NULL,
  games_played INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  lowest_score INTEGER,
  highest_score INTEGER,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (player_id, year_month)
);

CREATE TABLE IF NOT EXISTS global_stats (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  total_games INTEGER NOT NULL DEFAULT 0,
  longest_game_seconds INTEGER NOT NULL DEFAULT 0,
  longest_game_id TEXT,
  highest_games_in_one_day INTEGER NOT NULL DEFAULT 0,
  highest_games_in_one_day_date TEXT,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO global_stats (id, updated_at) VALUES (1, datetime('now'));
