"""Pack the approved c5/c14 generated walk grids into runtime sprite sheets.

Run from the repository root with Pillow, NumPy and SciPy installed:
    python tools/build_character_walks.py
The first 12 slots retain the legacy layout; slots 12..23 are four-frame
down, up and right walk cycles. Only c5 and c14 are written.
"""
from pathlib import Path
from PIL import Image
from v3lib import key_bg, components, tight

ROOT = Path(__file__).resolve().parents[1]
FW, FH, HEIGHT = 160, 140, 132


def build_character(folder, portraits=True):
    source = ROOT / f'design/Character_animation/c{folder}/walk-cycle.generated.png'
    with Image.open(source) as image:
        # The generator exported RGB with a checkerboard. The pipeline's
        # border-connected matte removal preserves enclosed white clothing.
        clean = key_bg(image, light=175, neutral=22, fringe=1)
    boxes = components(clean, min_size=80, dilate=0)
    assert len(boxes) == 12, f'{source}: expected 12 sprites, got {len(boxes)}'
    boxes.sort(key=lambda box: (box[1] + box[3]) / 2)
    ordered = []
    for row in range(3):
        ordered.extend(sorted(boxes[row * 4:row * 4 + 4], key=lambda box: box[0]))
    sprites = [tight(clean.crop(box)) for box in ordered]
    scale = min(HEIGHT / max(im.height for im in sprites), (FW - 4) / max(im.width for im in sprites))
    frames = []
    for sprite in sprites:
        resized = sprite.resize((round(sprite.width * scale), round(sprite.height * scale)), Image.Resampling.LANCZOS)
        frame = Image.new('RGBA', (FW, FH))
        frame.paste(resized, ((FW - resized.width) // 2, FH - 4 - resized.height))
        frames.append(frame)
    # Use the neutral passing pose when stopped, so stopping never switches
    # costumes or proportions between the old art and the new walking art.
    legacy = [frames[i] for i in [1, 1, 0, 2, 5, 5, 4, 6, 9, 9, 8, 10]]
    sheet = Image.new('RGBA', (FW * 24, FH))
    for index, frame in enumerate(legacy + frames):
        sheet.paste(frame, (index * FW, 0))
    output = ROOT / 'public/assets/chars'
    sheet.save(output / f'char_{folder - 1}.png')
    if portraits:
        portrait = Image.new('RGBA', (160, 240))
        sprite = sprites[1]
        ratio = min(156 / sprite.width, 236 / sprite.height)
        sprite = sprite.resize((round(sprite.width * ratio), round(sprite.height * ratio)), Image.Resampling.LANCZOS)
        portrait.paste(sprite, ((160 - sprite.width) // 2, 238 - sprite.height))
        portrait.save(output / f'portrait_{folder - 1}.png')
    print(f'c{folder}: packed 12 walking poses with consistent scale and foot baseline')


if __name__ == '__main__':
    for folder in (5, 14):
        build_character(folder)
