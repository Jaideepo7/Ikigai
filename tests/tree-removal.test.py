"""Verify tree cleanup removes all retired plants without affecting flowers or empty plots."""
import sqlite3
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class TreeRemovalTest(unittest.TestCase):
    def test_cleanup_preserves_flowers_and_empty_plots(self):
        db = sqlite3.connect(':memory:')
        for path in sorted((ROOT / 'migrations').glob('*.sql')):
            if path.name < '0006':
                db.executescript(path.read_text(encoding='utf-8'))
        for user_id in (1, 2):
            for plant_id in range(1, 33):
                db.execute('INSERT INTO plots (user_id,tx,ty,plant_id,stage) VALUES (?,?,?,?,?)',
                           (user_id, plant_id, 0, plant_id, plant_id % 4))
                db.execute('INSERT INTO inventory VALUES (?,?,?)', (user_id, plant_id, 5))
            db.execute('INSERT INTO plots (user_id,tx,ty) VALUES (?,0,1)', (user_id,))
        cleanup = (ROOT / 'migrations/0006_remove_plantable_trees.sql').read_text()
        for _ in range(2):  # Cleanup is also safe to repeat on account access.
            db.executescript(cleanup)
            for user_id in (1, 2):
                self.assertEqual(db.execute('SELECT count(*) FROM plots WHERE user_id=?', (user_id,)).fetchone()[0], 21)
                self.assertEqual(db.execute('SELECT plant_id,qty FROM inventory WHERE user_id=? ORDER BY plant_id',
                                            (user_id,)).fetchall(), [(plant_id, 5) for plant_id in range(1, 21)])
                self.assertEqual(db.execute('SELECT count(*) FROM plots WHERE user_id=? AND plant_id IS NULL',
                                            (user_id,)).fetchone()[0], 1)
        db.close()


if __name__ == '__main__':
    unittest.main()
