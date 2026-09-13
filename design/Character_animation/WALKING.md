# c5 and c14 walking

Only c5 (runtime ID 4) and c14 (runtime ID 13) use the new four-frame cycles.
Their `walk-cycle.generated.png` files were made with the built-in imagegen
tool using `walkanimationboy1.png` and `walkinganimation.png`, respectively.
The original references are preserved. Other characters retain their art.

Build with `python tools/build_character_walks.py` (Pillow, NumPy, SciPy).
The builder removes the generator's checkerboard matte using the existing
border-connected background-keying helper, packs the sprites at a shared
scale with transparent padding, and updates only `char_4.png`, `char_13.png`
and their matching portraits in `public/assets/chars/`.

The 160x140 sheets retain the original 12 frame slots for compatibility;
frames 12–15 walk down, 16–19 walk up, and 20–23 walk right. Left is mirrored.
Idle uses the corresponding neutral passing pose to avoid a costume change
when stopping. Four directional key pairs produce true normalized diagonal
velocity: upward diagonals use the rear view and downward diagonals use the
three-quarter side view. These are three views, not eight separately drawn
orientations. Walking runs at 8 frames/second, with running scaled by speed.

## Generation prompts

c14:

> Create a cleaned game-ready walking sprite sheet of exactly this c14 girl, preserving her spotted cream mushroom hat with pink bow, long black hair, white blouse, dark shorts, boots, backpack, chibi pixel-art style and proportions. Transparent background, no labels, no ground shadows, no colored fringe. Exact regular grid: 4 columns and 3 rows, 12 isolated full-body sprites. Row 1 faces directly DOWN toward viewer; row 2 faces directly UP away from viewer; row 3 faces RIGHT in three-quarter side view (all four face right, never alternate facing). In EACH row four successive walking poses: left foot forward, passing feet together, right foot forward, passing feet together. Real alternating leg and arm motion; keep head size and costume completely consistent. All cells equal sized; sprite feet at same baseline and body centered per cell, plenty of transparent padding. This is production sprite artwork, not a labeled presentation. Return local file path.

c5:

> Create a cleaned game-ready walking sprite sheet of exactly this c5 boy, preserving messy dark navy hair, white shirt, green vest and shorts, brown boots, brown backpack, chibi pixel-art style and proportions. Transparent background, no labels, no ground shadows, no colored fringe. Exact regular grid: 4 columns and 3 rows, 12 isolated full-body sprites. Row 1 faces directly DOWN toward viewer; row 2 faces directly UP away from viewer; row 3 faces RIGHT in three-quarter side view (all four face right, never alternate facing). In EACH row four successive walking poses: left foot forward, passing feet together, right foot forward, passing feet together. Real alternating leg and arm motion; keep head size and costume completely consistent. All cells equal sized; sprite feet at same baseline and body centered per cell, plenty of transparent padding. This is production sprite artwork, not a labeled presentation. Return local file path.
