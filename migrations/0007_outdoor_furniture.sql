ALTER TABLE furniture_placed ADD COLUMN location TEXT NOT NULL DEFAULT 'house' CHECK (location IN ('house', 'garden'));
CREATE INDEX furniture_placed_location ON furniture_placed(user_id, location);
