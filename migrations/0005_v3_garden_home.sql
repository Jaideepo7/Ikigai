-- v3: levels 0-100, 32-plant catalog, timed growth from planting, editable fences, quantity furniture, 20 character sets, 4 cards
ALTER TABLE users ADD COLUMN fence_color TEXT NOT NULL DEFAULT 'brown';
ALTER TABLE users ADD COLUMN garden_init INTEGER NOT NULL DEFAULT 0;
ALTER TABLE plots ADD COLUMN planted_at INTEGER;

CREATE TABLE fences (user_id INTEGER NOT NULL, tx INTEGER NOT NULL, ty INTEGER NOT NULL, kind TEXT NOT NULL, PRIMARY KEY (user_id, tx, ty));
CREATE TABLE furniture_owned (user_id INTEGER NOT NULL, furniture_id INTEGER NOT NULL, qty INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, furniture_id));
CREATE TABLE furniture_placed (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, furniture_id INTEGER NOT NULL, cx INTEGER NOT NULL, cy INTEGER NOT NULL, locked INTEGER NOT NULL DEFAULT 0);
CREATE INDEX furniture_placed_user ON furniture_placed(user_id);

-- old 6-item furniture -> closest items in the new catalog
INSERT INTO furniture_owned (user_id, furniture_id, qty)
  SELECT user_id, CASE furniture_id WHEN 1 THEN 38 WHEN 2 THEN 24 WHEN 3 THEN 7 WHEN 4 THEN 33 WHEN 5 THEN 13 ELSE 20 END, 1 FROM furniture;
DROP TABLE furniture;

-- 24 character sets became 20
UPDATE users SET character = character - 20 WHERE character >= 20;

-- old 16-plant ids -> new 32-plant ids (two steps so the inventory primary key never collides mid-update)
UPDATE inventory SET plant_id = 100 + CASE plant_id WHEN 1 THEN 18 WHEN 2 THEN 12 WHEN 3 THEN 13 WHEN 4 THEN 11 WHEN 5 THEN 15 WHEN 6 THEN 1 WHEN 7 THEN 10 WHEN 8 THEN 9 WHEN 9 THEN 19 WHEN 10 THEN 6 WHEN 11 THEN 25 WHEN 12 THEN 8 WHEN 13 THEN 20 WHEN 14 THEN 29 WHEN 15 THEN 30 WHEN 16 THEN 7 ELSE plant_id END WHERE plant_id <= 32;
UPDATE inventory SET plant_id = plant_id - 100 WHERE plant_id > 100;
UPDATE plots SET plant_id = CASE plant_id WHEN 1 THEN 18 WHEN 2 THEN 12 WHEN 3 THEN 13 WHEN 4 THEN 11 WHEN 5 THEN 15 WHEN 6 THEN 1 WHEN 7 THEN 10 WHEN 8 THEN 9 WHEN 9 THEN 19 WHEN 10 THEN 6 WHEN 11 THEN 25 WHEN 12 THEN 8 WHEN 13 THEN 20 WHEN 14 THEN 29 WHEN 15 THEN 30 WHEN 16 THEN 7 ELSE plant_id END WHERE plant_id IS NOT NULL;

-- growth is now a single timer from planting: restart anything that was mid-growth, keep mature plants mature
UPDATE plots SET planted_at = strftime('%s','now') * 1000, ready_at = strftime('%s','now') * 1000 + 1200000, stage = 0 WHERE plant_id IS NOT NULL AND stage < 3;
UPDATE plots SET ready_at = NULL WHERE stage >= 3;

-- only the four illustrated cards remain
DELETE FROM cards WHERE card_id > 3;
