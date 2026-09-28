CREATE TABLE players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  draft_position INTEGER NOT NULL UNIQUE
);

-- pick_number and team are both unique, so two simultaneous picks cannot
-- claim the same slot or the same team: the second insert simply fails.
CREATE TABLE picks (
  pick_number INTEGER PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id),
  team TEXT NOT NULL UNIQUE,
  picked_at TEXT NOT NULL
);

CREATE TABLE games (
  id INTEGER PRIMARY KEY,
  season INTEGER NOT NULL,
  game_type INTEGER NOT NULL,
  game_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  state TEXT NOT NULL,
  schedule_state TEXT NOT NULL,
  away TEXT NOT NULL,
  home TEXT NOT NULL,
  away_score INTEGER,
  home_score INTEGER,
  last_period_type TEXT
);

CREATE INDEX games_by_date ON games (game_date);

CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
