"""v3 asset pipeline: cut the sprite sheets in design/ into the individual PNGs the game loads.

Outputs (all under public/assets/):
  chars/char_{0..19}.png    160x140 x 12 frames: 0-1 idle down, 2-3 walk down, 4-5 idle up, 6-7 walk up, 8-9 idle side (faces right), 10-11 walk side
  chars/portrait_{i}.png    160x240 front view
  plants/flower_{1..20}.png, plants/tree_{21..32}.png, plants/twig.png
  fence/{piece}_{color}.png 17 autotile pieces x 7 colours (see PIECES / COLORS)
  furniture/f_{id}.png      40 curated items (see FURNITURE); prints the footprint table to paste into rules.ts
  scenes/house_ext.png, scenes/home_bg.png, ui/map.png, ui/spin_machine.png, scenes/soil.png
Run from the repo root: PYTHONUTF8=1 python tools/build_v3_assets.py
Use --sprites-only to rebuild just the in-game characters, preserving portraits and scenery.
"""
import os, sys, glob, colorsys, json
sys.path.insert(0, os.path.dirname(__file__))
from PIL import Image
import numpy as np
from v3lib import key_bg, components, tight

D = 'design/'; OUT = 'public/assets/'
for d in ['chars', 'plants', 'fence', 'furniture', 'scenes', 'ui']:
    os.makedirs(OUT + d, exist_ok=True)

# ---------- characters ----------
FW, FH, H_CHAR = 160, 140, 132
SPRITES_ONLY = '--sprites-only' in sys.argv

def fit(im, w, h, target_h, bottom=0):
    s = target_h / im.height
    r = im.resize((max(1, round(im.width * s)), target_h), Image.LANCZOS)
    if bottom:
        assert r.width <= w - 4, f'Character art exceeds frame width: {r.width} > {w - 4}'
    c = Image.new('RGBA', (w, h), (0, 0, 0, 0)); c.paste(r, ((w - r.width) // 2, h - target_h - bottom), r)
    return c
def breath(frame, split=0.62):
    """second idle frame: upper body 1px lower (chest rising illusion), feet untouched"""
    top = frame.crop((0, 0, FW, int(FH * split))); out = frame.copy()
    out.paste(Image.new('RGBA', (FW, int(FH * split)), (0, 0, 0, 0)), (0, 0)); out.paste(top, (0, 1), top)
    return out
def lift(frame, px=2):
    """walk frame: whole sprite raised px (a step) - the art itself is not altered"""
    out = Image.new('RGBA', (FW, FH), (0, 0, 0, 0)); out.paste(frame, (0, -px), frame); return out
def walk_strip(im):
    """split the 4-frame back-walk strip on transparent columns, one shared scale"""
    a = np.array(im)[:, :, 3] > 40
    cols = a.any(axis=0); runs = []; start = None
    for x, on in enumerate(list(cols) + [False]):
        if on and start is None: start = x
        if not on and start is not None:
            if runs and x - start < 16: runs[-1] = (runs[-1][0], x)
            else: runs.append((start, x))
            start = None
    if len(runs) != 4: runs = [(k * im.width // 4, (k + 1) * im.width // 4) for k in range(4)]
    rows = a.any(axis=1); y0, y1 = np.where(rows)[0][[0, -1]]; y1 += 1
    scale = H_CHAR / (y1 - y0); out = []
    for x0, x1 in runs:
        fr = im.crop((x0, y0, x1, y1)); r = fr.resize((max(1, round(fr.width * scale)), H_CHAR), Image.LANCZOS)
        assert r.width <= FW - 4, f'Walk art exceeds frame width: {r.width} > {FW - 4}'
        c = Image.new('RGBA', (FW, FH), (0, 0, 0, 0)); c.paste(r, ((FW - r.width) // 2, FH - H_CHAR - 2), r); out.append(c)
    return out

for i in range(20):
    if i in (4, 13):
        from build_character_walks import build_character
        build_character(i + 1, portraits=not SPRITES_ONLY)
        continue
    files = [Image.open(f).convert('RGBA') for f in sorted(glob.glob(D + f'Character_animation/c{i + 1}/image*.png'))]
    walk = next(f for f in files if f.width > 1500)
    side = next(f for f in files if f.width <= 1500 and f.height > 800)
    front = next(f for f in files if f.width <= 1500 and f.height <= 800)
    f = fit(tight(front), FW, FH, H_CHAR, bottom=2); s = fit(tight(side), FW, FH, H_CHAR, bottom=2); w = walk_strip(walk)
    frames = [f, breath(f), f, lift(f), w[0], breath(w[0]), w[1], w[3], s, breath(s), s, lift(s)]
    sheet = Image.new('RGBA', (FW * 12, FH), (0, 0, 0, 0))
    for j, fr in enumerate(frames): sheet.paste(fr, (j * FW, 0))
    sheet.save(OUT + f'chars/char_{i}.png')
    if not SPRITES_ONLY:
        fit(tight(front), 160, 240, 236).save(OUT + f'chars/portrait_{i}.png')
if SPRITES_ONLY:
    print('20 character sheets rebuilt; portraits and scenery unchanged')
    sys.exit(0)
for f in glob.glob(OUT + 'chars/char_2[0-3].png') + glob.glob(OUT + 'chars/portrait_2[0-3].png'): os.remove(f)
print('chars ok')

# ---------- plants ----------
def cells(im, cols, rows):
    cw, ch = im.width / cols, im.height / rows
    return [im.crop((int(c * cw), int(r * ch), int((c + 1) * cw), int((r + 1) * ch))) for r in range(rows) for c in range(cols)]
flowers = cells(key_bg(Image.open(D + 'Flower.png'), light=246, neutral=9, fringe=0), 5, 4)
for k, im in enumerate(flowers): tight(im).save(OUT + f'plants/flower_{k + 1}.png')
trees = cells(key_bg(Image.open(D + 'Trees.png'), light=225, neutral=30), 6, 2)
for k, im in enumerate(trees): tight(im).save(OUT + f'plants/tree_{k + 21}.png')
tight(key_bg(Image.open(D + 'Twig.png'), light=225, neutral=30)).save(OUT + 'plants/twig.png')
for f in glob.glob(OUT + 'plants/plant_*.png'): os.remove(f)
print('plants ok')

# ---------- fence (autotile pieces + recolours) ----------
fence = key_bg(Image.open(D + 'fence.png'))
fb = components(fence, min_size=30, dilate=3)
PIECES = { 'post': 34, 'h_l': 2, 'h_m': 3, 'h_m2': 8, 'h_r': 4, 'v_t': 14, 'v_m': 15, 'v_m2': 17, 'v_b': 16,
           'tl': 20, 'tr': 21, 'bl': 22, 'br': 23, 't_up': 27, 't_down': 28, 't_left': 29, 't_right': 30, 'cross': 31, 'gate': 5, 'gate_open': 6 }
COLORS = { 'brown': (128, 82, 40), 'dark_brown': (78, 46, 22), 'light_brown': (186, 138, 84), 'black': (34, 30, 30), 'dark_grey': (92, 92, 96), 'light_grey': (172, 172, 176), 'white': (236, 232, 224) }
S_FENCE = 64 / (fb[3][2] - fb[3][0])   # the horizontal middle piece spans one tile
def recolor(im, rgb):
    """wood pixels (brown hue) -> target colour scaled by the pixel's own brightness; foliage/flowers untouched"""
    a = np.array(im).astype(float); r, g, b = a[:, :, 0] / 255, a[:, :, 1] / 255, a[:, :, 2] / 255
    mx, mn = np.maximum(np.maximum(r, g), b), np.minimum(np.minimum(r, g), b); d = mx - mn + 1e-6
    h = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) / 6
    sat = d / (mx + 1e-6); wood = (h > 0.02) & (h < 0.14) & (sat > 0.2) & (a[:, :, 3] > 0)
    lum = (0.3 * r + 0.59 * g + 0.11 * b) / 0.45   # brown reference brightness ~0.45
    t = np.array(rgb) / 255
    for c in range(3): a[:, :, c] = np.where(wood, np.clip(t[c] * lum * 255, 0, 255), a[:, :, c])
    return Image.fromarray(a.astype(np.uint8), 'RGBA')
for name, idx in PIECES.items():
    piece = tight(fence.crop(fb[idx]))
    piece = piece.resize((max(1, round(piece.width * S_FENCE)), max(1, round(piece.height * S_FENCE))), Image.LANCZOS)
    for cname, rgb in COLORS.items(): (piece if cname == 'brown' else recolor(piece, rgb)).save(OUT + f'fence/{name}_{cname}.png')
print('fence ok', len(PIECES), 'pieces x', len(COLORS), 'colours')

# ---------- furniture ----------
furn = key_bg(Image.open(D + 'furniture.png'))
fub = components(furn, min_size=24, dilate=2)
# (id, sheet index, name, price, kind); kind: solid | walk | rug | bed
FURNITURE = [
    (1, 0, 'Green Plaid Bed', 180, 'bed'), (2, 2, 'Pink Bed', 180, 'bed'), (3, 3, 'Blue Bed', 180, 'bed'), (4, 4, 'Yellow Check Bed', 180, 'bed'),
    (5, 11, 'Oak Nightstand', 45, 'solid'), (6, 14, 'Book Nightstand', 45, 'solid'), (7, 17, 'Small Dresser', 90, 'solid'), (8, 18, 'Flower Dresser', 110, 'solid'),
    (9, 19, 'Vanity Mirror', 120, 'solid'), (10, 20, 'Green Wardrobe', 130, 'solid'), (11, 21, 'Oak Wardrobe', 130, 'solid'), (12, 13, 'Standing Mirror', 85, 'solid'),
    (13, 34, 'Bookcase', 140, 'bookcase'), (14, 27, 'Plant Bookcase', 160, 'bookcase'), (15, 28, 'Green Hutch', 170, 'solid'), (16, 31, 'Ladder Shelf', 70, 'solid'),
    (17, 32, 'Fireplace', 260, 'solid'), (18, 41, 'Writing Desk', 150, 'desk'), (19, 46, 'Side Table', 55, 'solid'), (20, 43, 'Dining Table', 140, 'solid'),
    (21, 44, 'Round Table', 80, 'solid'), (22, 47, 'Coffee Table', 95, 'solid'), (23, 48, 'Garden Bench', 90, 'solid'), (24, 55, 'Wooden Chair', 40, 'walk'),
    (25, 56, 'Cushion Chair', 50, 'walk'), (26, 57, 'Green Chair', 50, 'walk'), (27, 59, 'Stool', 30, 'walk'), (28, 61, 'Armchair', 120, 'solid'),
    (29, 62, 'Cream Sofa', 200, 'solid'), (30, 63, 'Cat Beanbag', 95, 'walk'), (31, 68, 'Floor Lamp', 75, 'solid'), (32, 70, 'Mushroom Lamp', 65, 'solid'),
    (33, 73, 'Green Rug', 110, 'rug'), (34, 76, 'Plaid Rug', 110, 'rug'), (35, 78, 'Pink Rug', 110, 'rug'), (36, 75, 'Round Rug', 80, 'rug'),
    (37, 79, 'Bear Rug', 130, 'rug'), (38, 82, 'Monstera', 60, 'solid'), (39, 84, 'Snake Plant', 45, 'solid'), (40, 93, 'Flower Planter', 70, 'solid'),
]
S_FURN = 64 / 66   # one room tile is ~66px on this sheet
table = []
for fid, idx, name, price, kind in FURNITURE:
    im = tight(furn.crop(fub[idx])); im = im.resize((max(1, round(im.width * S_FURN)), max(1, round(im.height * S_FURN))), Image.LANCZOS)
    im.save(OUT + f'furniture/f_{fid}.png')
    w = max(1, -(-(im.width - 16) // 64)); h = max(1, -(-(im.height - 16) // 64)) if kind == 'rug' else 2 if kind == 'bed' else 1
    table.append(f"  {{ id: {fid}, name: '{name}', price: {price}, kind: '{kind}', w: {w}, h: {h} }},")
print('furniture ok'); print('\n'.join(table))

# ---------- scenes ----------
house = tight(key_bg(Image.open(D + 'house.png'))); house = house.resize((512, round(house.height * 512 / house.width)), Image.LANCZOS); house.save(OUT + 'scenes/house_ext.png')
Image.open(D + 'home.png').convert('RGB').save(OUT + 'scenes/home_bg.png')
Image.open(D + 'map.png').convert('RGB').resize((1200, 802), Image.LANCZOS).save(OUT + 'ui/map.png', optimize=True)
spin = Image.open(D + 'spin_slot.png').convert('RGBA'); spin = tight(spin); spin.resize((spin.width // 2, spin.height // 2), Image.LANCZOS).save(OUT + 'ui/spin_machine.png')
# tilled soil tile: rounded dark patch with rubble and furrows, drawn at 16px and scaled x4 so it matches the ground tiles
rng = np.random.default_rng(7); soil = np.zeros((16, 16, 4), np.uint8); soil[:, :, :3] = (150, 110, 70); soil[:, :, 3] = 0
for y in range(16):
    for x in range(16):
        inside = 1 <= x <= 14 and 1 <= y <= 14 and not ((x in (1, 14)) and (y in (1, 14)))
        if inside:
            base = (118, 80, 48) if (y % 4 in (1, 2)) else (96, 62, 36)
            k = rng.random(); col = (72, 44, 24) if k < 0.12 else (146, 104, 66) if k < 0.22 else base
            soil[y, x] = (*col, 255)
Image.fromarray(soil, 'RGBA').resize((64, 64), Image.NEAREST).save(OUT + 'scenes/soil.png')
print('scenes ok', house.size, spin.size)
