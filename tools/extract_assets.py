"""Turn the design mockups in design/ into game-ready sprites in public/assets/.
Run: python tools/extract_assets.py   (needs Pillow + numpy)
"""
from PIL import Image, ImageOps
import numpy as np, os, json

D = 'design/'; OUT = 'public/assets/'
os.makedirs(OUT, exist_ok=True)

def bbox_alpha(im, thr=40):
    a = np.array(im)[:, :, 3]
    ys, xs = np.where(a > thr)
    return (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)

def fit(im, w, h, anchor='bottom'):
    """Scale im to fit inside w×h keeping aspect, paste centered (bottom-aligned if anchor=bottom)."""
    s = min(w / im.width, h / im.height)
    r = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
    c = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    y = h - r.height if anchor == 'bottom' else (h - r.height) // 2
    c.paste(r, ((w - r.width) // 2, y), r)
    return c

def grid_cells(im, cols, rows):
    cw, ch = im.width / cols, im.height / rows
    for r in range(rows):
        for c in range(cols):
            yield im.crop((int(c * cw), int(r * ch), int((c + 1) * cw), int((r + 1) * ch)))

def tight(im):
    return im.crop(bbox_alpha(im))

# ---------- characters: 24 gardeners -> chars/char_{i}.png (6 frames 72x104: front, back, walk1-4) ----------
FW, FH = 72, 104
front = Image.open(D + 'image20.png').convert('RGBA')
back = Image.open(D + 'image21.png').convert('RGBA')
walk = Image.open(D + 'image22.png').convert('RGBA')
fronts = [tight(c) for c in grid_cells(front, 8, 3)]
backs = [tight(c) for c in grid_cells(back, 8, 3)]
walks = []
for r in range(6):                       # rows are 160px pitch (sheet has 64px empty at bottom)
    for c in range(4):
        group = walk.crop((c * 384, r * 160, (c + 1) * 384, (r + 1) * 160))
        walks.append([tight(f) for f in grid_cells(group, 4, 1)])
for i in range(24):
    frames = [fronts[i], backs[i]] + walks[i]
    sheet = Image.new('RGBA', (FW * 6, FH), (0, 0, 0, 0))
    for j, f in enumerate(frames):
        sheet.paste(fit(f, FW, FH), (j * FW, 0))
    sheet.save(OUT + f'chars/char_{i}.png')
    fit(fronts[i], 160, 240).save(OUT + f'chars/portrait_{i}.png')
print('chars ok')

# ---------- plants: 36 sprites from white-bg sheet -> plants/plant_{i}.png 64x64 ----------
pl = Image.open(D + 'image15.png').convert('RGBA')
arr = np.array(pl).astype(int)
white = (arr[:, :, :3] > 235).all(axis=2)
arr[:, :, 3] = np.where(white, 0, 255)
pl = Image.fromarray(arr.astype('uint8'))
for i, c in enumerate(grid_cells(pl, 6, 6)):
    fit(tight(c), 64, 64).save(OUT + f'plants/plant_{i}.png')
print('plants ok')

# ---------- house interior: crop navbar, paint out the character ----------
house = Image.open(D + 'image3.png').convert('RGB')
# floor strip above rug (character head/torso): copy planks from the left at same rows
floor = house.crop((3086, 1740, 3480, 2139)); house.paste(floor, (2540, 1740)); house.paste(floor, (2934, 1740))  # clean planks right of the character
# rug band under character: mirror the rug's bottom band upward
band = ImageOps.flip(house.crop((2540, 2591, 3120, 2921))); house.paste(band, (2540, 2139))
house = house.crop((0, 411, 5760, 3804)).resize((1440, 848), Image.LANCZOS)
house.save(OUT + 'scenes/house.png', optimize=True)
print('house ok')

# ---------- garden mockup crops (tiles + props) ----------
g = Image.open(D + 'image19.png').convert('RGBA')
S = 3840 / 1400  # thumb->orig factor
def gcrop(x1, y1, x2, y2, name, w=None):
    im = g.crop((round(x1 * S), round(y1 * S), round(x2 * S), round(y2 * S)))
    if w: im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
    im.save(OUT + f'scenes/{name}.png'); return im
gcrop(430, 104, 1000, 395, 'house_facade', 560)   # porch + door
gcrop(1195, 400, 1400, 660, 'tree_big', 200)
gcrop(1160, 720, 1300, 860, 'bush_round', 130)
gcrop(350, 290, 420, 380, 'barrel', 64)
gcrop(1020, 165, 1090, 245, 'barrel2', 64)
gcrop(1010, 270, 1075, 360, 'mailbox', 56)
gcrop(150, 140, 265, 240, 'bench', 110)
gcrop(1240, 170, 1400, 260, 'chest', 150)
gcrop(925, 140, 1000, 190, 'stone', 64)
gcrop(1230, 660, 1300, 770, 'bench2', 0 or None)
# fence pieces
gcrop(200, 500, 560, 545, 'fence_h', 360)
# tiles
# seamless grass: random 4px speckles drawn from the mockup's own grass colours (a raw crop tiles with visible seams)
tg = g.crop((round(1218 * S), round(602 * S), round(1266 * S), round(650 * S))).convert('RGB')
cols = sorted(tg.getcolors(tg.width * tg.height), reverse=True)[:6]
import random; random.seed(7)
cols = [(n, tuple(min(255, int(c * 1.14)) for c in col)) for n, col in cols]   # mockup grass reads brighter at game scale
grass = Image.new('RGB', (128, 128), cols[0][1]); px = grass.load()
weights = [c[0] for c in cols]
for y in range(0, 128, 4):
    for x in range(0, 128, 4):
        col = random.choices([c[1] for c in cols], weights)[0]
        for dy in range(4):
            for dx in range(4): px[x + dx, y + dy] = col
grass.save(OUT + 'scenes/tile_grass.png')
# tiny procedural daisy to scatter on the grass (a crop from the mockup keyed badly against the generated grass)
fl = Image.new('RGBA', (14, 14), (0, 0, 0, 0)); fp = fl.load()
for (x, y) in [(5, 1), (6, 1), (7, 1), (8, 1), (1, 5), (1, 6), (1, 7), (1, 8), (12, 5), (12, 6), (12, 7), (12, 8), (5, 12), (6, 12), (7, 12), (8, 12),
               (3, 3), (4, 3), (3, 4), (9, 3), (10, 3), (10, 4), (3, 9), (3, 10), (4, 10), (9, 10), (10, 10), (10, 9),
               (5, 2), (8, 2), (2, 5), (2, 8), (11, 5), (11, 8), (5, 11), (8, 11), (4, 4), (9, 4), (4, 9), (9, 9)]:
    fp[x, y] = (240, 235, 204, 255)
for y in range(5, 9):
    for x in range(5, 9): fp[x, y] = (232, 190, 70, 255)
fl.save(OUT + 'scenes/flower.png')
gcrop(680, 585, 720, 625, 'tile_path', 64)
gcrop(300, 620, 325, 645, 'tile_dirt', 64)
gcrop(28, 520, 62, 860, 'fence_v', 34)
print('garden crops ok')

# ---------- navbar icons from image2 ----------
nav = Image.open(D + 'image2.png').convert('RGBA')
T = 5760 / 1400
icons = {'pomodoro': (885, 8, 945, 66), 'tasks': (970, 8, 1050, 66), 'map': (1082, 8, 1140, 66),
         'inventory': (1160, 8, 1220, 66), 'shop': (1240, 8, 1310, 66), 'settings': (1325, 8, 1390, 66)}
for k, (x1, y1, x2, y2) in icons.items():
    im = nav.crop((round(x1 * T), round(y1 * T), round(x2 * T), round(y2 * T)))
    a = np.array(im).astype(int)
    r, gg, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    bg = (abs(r - 99) < 28) & (abs(gg - 139) < 28) & (abs(b - 165) < 28)  # navbar blue #638BA5
    a[:, :, 3] = np.where(bg, 0, 255)
    fit(tight(Image.fromarray(a.astype('uint8'))), 56, 56, 'center').save(OUT + f'ui/icon_{k}.png')
print('icons ok')

# ---------- map picture from image5 ----------
mp = Image.open(D + 'image5.png').convert('RGB')
mp.crop((round(322 * T), round(262 * T), round(1125 * T), round(718 * T))).resize((1200, 681), Image.LANCZOS).save(OUT + 'ui/map.png', optimize=True)

# ---------- cards from image18 ----------
cd = Image.open(D + 'image18.png').convert('RGB')   # native 1108px, no scaling
for i, x1 in enumerate([107, 272, 439, 605]):
    cd.crop((x1, 284, x1 + 130, 398)).save(OUT + f'cards/card_{i}.png')

# ---------- landing art from image1 ----------
ld = Image.open(D + 'image1.png').convert('RGB')
L = 5760 / 1098
ld.crop((round(660 * L), round(155 * L), round(1045 * L), round(632 * L))).resize((600, 743), Image.LANCZOS).save(OUT + 'ui/landing_hero.png', optimize=True)
lm = Image.open(D + 'image1.png').convert('RGBA')
lm.crop((round(430 * L), round(900 * L), round(1050 * L), round(1225 * L))).resize((900, 472), Image.LANCZOS).save(OUT + 'ui/slot_machine.png', optimize=True)
# logo text
print('done')
