-- Profile pictures, keyed by player name rather than id so that they
-- survive a league reset and a new draw.
CREATE TABLE avatars (
  name TEXT PRIMARY KEY,
  image TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
