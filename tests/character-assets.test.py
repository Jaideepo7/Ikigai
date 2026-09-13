"""Check the shipped character sheets for clipped artwork and runtime frame compatibility.

Run with the asset pipeline's Python environment (Pillow required).
"""
import re
import unittest
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


class CharacterAssetsTest(unittest.TestCase):
    def test_all_animation_frames_have_transparent_padding(self):
        player = (ROOT / 'src/game/Player.ts').read_text(encoding='utf-8')
        match = re.search(r'FRAME = \{ w: (\d+), h: (\d+) \}', player)
        width, height = map(int, match.groups())
        for character in range(20):
            with Image.open(ROOT / f'public/assets/chars/char_{character}.png') as sheet:
                self.assertEqual(sheet.size, (12 * width, height))
                for frame in range(12):
                    with self.subTest(character=character, frame=frame):
                        alpha = sheet.getchannel('A').crop((frame * width, 0, (frame + 1) * width, height))
                        bounds = alpha.getbbox()
                        self.assertIsNotNone(bounds)
                        left, top, right, bottom = bounds
                        self.assertGreaterEqual(left, 2, 'left edge clipped')
                        self.assertGreaterEqual(top, 2, 'hat clipped')
                        self.assertLessEqual(right, width - 2, 'right edge clipped')
                        self.assertLessEqual(bottom, height - 2, 'feet clipped')


if __name__ == '__main__':
    unittest.main()
