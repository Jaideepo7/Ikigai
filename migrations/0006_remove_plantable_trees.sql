-- Retire plantable trees, including starter trees, for every existing account.
-- Decorative border trees are scene objects and have no rows in these tables.
DELETE FROM plots WHERE plant_id BETWEEN 21 AND 32;
DELETE FROM inventory WHERE plant_id BETWEEN 21 AND 32;
