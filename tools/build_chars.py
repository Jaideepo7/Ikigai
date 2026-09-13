"""Character spritesheets v2 from the three team sheets in design/ (front, back, back-walk).

Output public/assets/chars/char_{i}.png, 96x140 frames, 12 frames:
  0-1   idle down
  2-3   walk down
  4-5   idle up
  6-7   walk up
  8-9   idle side
  10-11 walk side
Also public/assets/chars/portrait_{i}.png (160x240) and public/assets/ui/icon_*.png pixel icons.
Run: python tools/build_chars.py
"""
from PIL import Image, ImageOps
import numpy as np, os

D = 'design/'; OUT = 'public/assets/'
FW, FH = 96, 140
os.makedirs(OUT + 'chars', exist_ok=True); os.makedirs(OUT + 'ui', exist_ok=True)

def bbox(im, thr=40):
    a = np.array(im)[:, :, 3]; ys, xs = np.where(a > thr)
    return (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
def tight(im): return im.crop(bbox(im))
def cells(im, cols, rows):
    cw, ch = im.width / cols, im.height / rows
    return [im.crop((int(c * cw), int(r * ch), int((c + 1) * cw), int((r + 1) * ch))) for r in range(rows) for c in range(cols)]
def fit(im, w, h, target_h):
    """scale to target height, centre horizontally, bottom-align in a w x h frame"""
    s = target_h / im.height
    r = im.resize((max(1, round(im.width * s)), target_h), Image.LANCZOS)
    c = Image.new('RGBA', (w, h), (0, 0, 0, 0)); c.paste(r, ((w - r.width) // 2, h - target_h), r)
    return c
def breath(frame, split=0.62):
    """idle frame 2: shift the upper body down 1px (chest rising illusion)"""
    top = frame.crop((0, 0, FW, int(FH * split))); out = frame.copy()
    out.paste(Image.new('RGBA', (FW, int(FH * split)), (0, 0, 0, 0)), (0, 0)); out.paste(top, (0, 1), top)
    return out
def shuffle(frame, dx, lift):
    """walk frame from a standing frame: legs (bottom 28%) shifted dx px, body lifted `lift` px"""
    cut = int(FH * 0.72)
    body = frame.crop((0, 0, FW, cut)); legs = frame.crop((0, cut, FW, FH))
    out = Image.new('RGBA', (FW, FH), (0, 0, 0, 0))
    out.paste(legs, (dx, cut), legs); out.paste(body, (0, -lift), body)
    return out

front = cells(Image.open(D + 'image20.png').convert('RGBA'), 8, 3)
back = cells(Image.open(D + 'image21.png').convert('RGBA'), 8, 3)
walk = Image.open(D + 'image22.png').convert('RGBA')
groups = [walk.crop((c * 384, r * 160, (c + 1) * 384, (r + 1) * 160)) for r in range(6) for c in range(4)]
# the walk sheet lists characters 16..23 one slot early and puts 15 last
walk_index = lambda c: c if c < 15 else (23 if c == 15 else c - 1)

H_CHAR = 132  # sprite height inside the 140px frame

def walk_frames(group):
    """split a 4-frame walk strip on transparent columns (frames overflow the 96px cells) with one shared scale"""
    a = np.array(group)[:, :, 3] > 40
    cols = a.any(axis=0); runs = []; start = None
    for x, on in enumerate(list(cols) + [False]):
        if on and start is None: start = x
        if not on and start is not None:
            if runs and x - start < 12: runs[-1] = (runs[-1][0], x)   # glue slivers (hands, hair wisps) to the previous frame
            else: runs.append((start, x))
            start = None
    if len(runs) != 4: runs = [(k * 96, (k + 1) * 96) for k in range(4)]
    rows = a.any(axis=1); y0, y1 = np.where(rows)[0][[0, -1]]; y1 += 1
    scale = H_CHAR / (y1 - y0)
    out = []
    for x0, x1 in runs:
        fr = group.crop((x0, y0, x1, y1))
        r = fr.resize((max(1, round(fr.width * scale)), H_CHAR), Image.LANCZOS)
        c = Image.new('RGBA', (FW, FH), (0, 0, 0, 0)); c.paste(r, ((FW - r.width) // 2, FH - H_CHAR), r); out.append(c)
    return out
for i in range(24):
    f = fit(tight(front[i]), FW, FH, H_CHAR)
    b = fit(tight(back[i]), FW, FH, H_CHAR)
    w = walk_frames(groups[walk_index(i)])
    side = w[1]
    frames = [
        f, breath(f),
        shuffle(f, -3, 1), shuffle(f, 3, 1),
        b, breath(b),
        w[0], w[2],
        side, breath(side),
        w[1], w[3],
    ]
    sheet = Image.new('RGBA', (FW * len(frames), FH), (0, 0, 0, 0))
    for j, fr in enumerate(frames): sheet.paste(fr, (j * FW, 0))
    sheet.save(OUT + f'chars/char_{i}.png')
    fit(tight(front[i]), 160, 240, 236).save(OUT + f'chars/portrait_{i}.png')
print('chars ok')

# ---------- pixel icons (16x16, drawn by hand) ----------
def icon(name, rows, pal):
    im = Image.new('RGBA', (16, 16), (0, 0, 0, 0)); px = im.load()
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch != '.': px[x, y] = pal[ch]
    im.resize((64, 64), Image.NEAREST).save(OUT + f'ui/{name}.png')
icon('coin', [
    '.....oooooo.....', '...oooyyyyooo...', '..ooyyyyyyyyoo..', '.ooyyyyyyyyyyoo.', '.oyyyyyddyyyyyo.', 'oyyyyydyyyddyyyo', 'oyyyyydyyyyyyyyo',
    'oyyyyyyddyyyyyyo', 'oyyyyyyyyddyyyyo', 'oyyyyyyyyyydyyyo', 'oyyyyyddyyydyyyo', '.oyyyyyyddddyyo.', '.ooyyyyyyyyyyoo.', '..ooyyyyyyyyoo..',
    '...oooyyyyooo...', '.....oooooo.....'], {'o': (140, 92, 20, 255), 'y': (240, 196, 60, 255), 'd': (200, 140, 30, 255)})
icon('gem', [
    '................', '....pppppppp....', '...plllppppdp...', '..pllllpppppdp..', '.plllllppppppdp.', 'pllllllpppppppdp', 'pppppppppppppppp',
    '.pppppppppppppd.', '..ppppppppppdd..', '...pppppppppd...', '....ppppppdd....', '.....pppppd.....', '......pppd......', '.......pp.......',
    '........p.......', '................'], {'p': (150, 70, 210, 255), 'l': (215, 170, 255, 255), 'd': (90, 30, 140, 255)})
icon('streak', [
    '.......gg.......', '......gggg......', '.....gggggg.....', '....gggggggg....', '....ggGGGGgg....', '...ggGGGGGGgg...', '...ggGGGGGGgg...',
    '..ggGGGGGGGGgg..', '..ggGGGGGGGGgg..', '..ggGGGGGGGGgg..', '...ggGGGGGGgg...', '....ggGGGGgg....', '.....gggggg.....', '......bbbb......',
    '.....bbbbbb.....', '................'], {'g': (60, 130, 60, 255), 'G': (140, 200, 90, 255), 'b': (116, 88, 82, 255)})
icon('xp', [
    '.......yy.......', '......yyyy......', '......yyyy......', '.....yyyyyy.....', 'yyyyyyyyyyyyyyyy', '.yyyyyyyyyyyyyy.', '..yyyyyyyyyyyy..',
    '...yyyyyyyyyy...', '...yyyyyyyyyy...', '..yyyyyyyyyyyy..', '..yyyyy..yyyyy..', '.yyyy......yyyy.', 'yyy..........yyy', '................',
    '................', '................'], {'y': (240, 196, 60, 255)})
icon('lock', [
    '................', '.....bbbbbb.....', '....bb....bb....', '....b......b....', '....b......b....', '..dddddddddddd..', '..dddddddddddd..', '..ddddd..ddddd..',
    '..ddddd..ddddd..', '..dddddddddddd..', '..dddddddddddd..', '..dddddddddddd..', '...dddddddddd...', '................', '................', '................'],
    {'b': (120, 120, 120, 255), 'd': (90, 90, 90, 255)})
print('icons ok')
