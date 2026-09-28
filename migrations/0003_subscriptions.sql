-- Players who asked for an email on every pick. Keyed by player name, like
-- avatars, so a subscription survives a league reset.
CREATE TABLE subscriptions (
  name TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL
);
