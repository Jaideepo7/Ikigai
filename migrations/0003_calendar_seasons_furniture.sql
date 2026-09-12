ALTER TABLE users ADD COLUMN season TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE tasks ADD COLUMN due_date TEXT;
ALTER TABLE tasks ADD COLUMN priority INTEGER NOT NULL DEFAULT 2;

CREATE TABLE furniture (
  user_id INTEGER NOT NULL,
  furniture_id INTEGER NOT NULL,
  slot INTEGER,
  PRIMARY KEY (user_id, furniture_id),
  UNIQUE (user_id, slot)
);

CREATE TABLE task_folders (
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (user_id, name)
);
