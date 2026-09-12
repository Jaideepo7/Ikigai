CREATE TABLE owned_seasons (
  user_id INTEGER NOT NULL,
  season TEXT NOT NULL,
  PRIMARY KEY (user_id, season)
);
