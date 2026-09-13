# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Ikigai: a retro top-down productivity game (Phaser 3 + TypeScript + Vite client, one Cloudflare Worker backend with
Hono, D1, and a Durable Object per user for realtime). Hackathon project, deployed at
https://ikigai.jaideeep-prabish.workers.dev. Full feature description and play loop are in README.md.

## Commands

```bash
npm run build                                    # vite build -> dist/ (the Worker serves dist/ as static assets)
npx wrangler d1 migrations apply ikigai --local  # creates/updates the local SQLite DB in .wrangler/; rerun after adding migrations
npx wrangler dev                                 # http://localhost:8787 — API + game, serves the last `npm run build`
npm run dev                                      # vite on :5173 with HMR, proxies /api and /ws to wrangler on :8787
npm run typecheck                                # two tsconfigs: client (DOM lib) and worker (workers-types); they must stay separate
npm test                                         # rules unit tests (node --test, runs .ts directly on Node 22)
bash tests/api_smoke.sh                          # full API flow with curl against a running wrangler dev
node tests/features.e2e.mjs                      # Playwright: admin level, focus lock, shop rotation, furniture, seasons, fences, plants
node tests/e2e.mjs out/                          # Playwright: two users, realtime friend toasts, knock/accept, chat; BASE=<url> for production
node tests/e2e_states.mjs out/                   # level-up garden, wither, frozen, card case; edits local D1 via wrangler
node tools/seed_admins.mjs [--remote]            # admin1..admin4 / "ikigai-admin": level 60, everything owned
npm run deploy                                   # vite build + wrangler deploy
npx wrangler d1 migrations apply ikigai --remote # after adding migrations/000N_*.sql
PYTHONUTF8=1 python tools/build_v3_assets.py     # regenerate public/assets/{chars,plants,fence,furniture,scenes,ui} from design/
```

The e2e scripts need a built `dist/` and a running `wrangler dev`. After changing client code, run `npm run build` before
re-running them (wrangler serves dist/, not src/). Python tools need Pillow + numpy + scipy and `PYTHONUTF8=1` on Windows.
The e2e scripts expose `window.__game` (the Phaser game) and `window.__refresh` (refreshMe) for assertions.

## Architecture

**One source of truth for numbers**: `src/shared/rules.ts` holds every tunable (reward formula, level curve 0-100,
garden size per level, growth timers + harvest reward, plant/card/furniture catalogs, fence autotiling, furniture
placement rules, shop rotation, day/timezone helpers) and the shared API types. It is imported by both the client and
the Worker; `tests/rules.test.ts` pins the intended values. Change balance there, nowhere else.

**Worker (`worker/index.ts`)**: Hono app. `/api/auth/*` is public; everything else under `/api/*` goes through a
middleware that loads the session user from the `sid` cookie and runs `rollover()` — the day-boundary logic that
breaks streaks and withers the garden for missed days. "Today" is computed from the `x-tz` header the client sends.
`meResponse()` runs `ensureInit()` (first-visit starter fence ring + two trees + bed/desk/bookcase, guarded by
`users.garden_init`) and `settlePlots()` (plants whose `ready_at` passed become stage 3 and pay their one-time
`plantReward`). The Worker also serves `dist/` via the ASSETS binding with SPA fallback; `run_worker_first` in
wrangler.jsonc limits the Worker to `/api/*` and `/ws/*`.

**Realtime (`worker/garden-room.ts`)**: `GardenRoom` Durable Object, one per user id, using the WebSocket hibernation
API. Two kinds of sockets live in it: garden peers (`/ws/garden/:id`, with the pending/knock flow for visitors while
the owner is present) and **hub** sockets (`/ws/hub`, tagged `hub`, one per open session of the owner). Hub sockets
are never peers or presence; `POST /notify` on the DO fans a message out to them — the friend request / accept /
remove routes use it, and `src/game/hub.ts` turns those into toasts + a `friends` bus event.

**Client state**: `src/state.ts` is the whole store: `store.me` (the `/api/me` payload), `refreshMe()`, and an
`EventTarget` bus. Every mutation calls `refreshMe()`; the navbar HUD and the active Phaser scene re-render on the `me`
event (scenes implement `onMe()`). If you mutate through fetch outside the UI (tests), call `__refresh()` yourself.

**UI vs game**: all panels are HTML strings in `src/ui/panels.ts` rendered into `#overlay` above the Phaser canvas;
`openPanel()` enforces one panel at a time and `isPanelOpen()` is how scenes freeze movement. User-supplied strings
must go through `esc()` before `innerHTML`. `setNavMode('garden')` hides every navbar button except Map and
Settings (and disables their hotkeys); scenes call it on create/teardown. Non-panel overlays: `#garden-hud`,
`#palette` (build mode), `#house-hud`, `#fmenu` (furniture menu), `#tip` (plant hover), `#knock`, `#waiting`.
The Pomodoro engine is module state in panels.ts; `isPomodoroActive()` gates the garden with the exact message
`POMODORO_LOCK_MSG` (in `src/game/index.ts`) from both `goto()` and the house door.

**Scenes (`src/game/`)**:
- `GardenScene`: an N×N editable grid (`gardenTiles(level)`) below the cottage (`house_ext`), 3 grass tiles of
  margin. Fences/gates come from `me().fences` and are autotiled per tile via `fencePiece(n,e,s,w)`; a gate with
  only N/S neighbours is drawn rotated; gates swap to the open sprite when the player is near. Plots draw `soil` +
  the plant at `plantStage()` (0 = bare soil, 1 = twig, 2 = 55 %, 3 = full); trees get a small base collider,
  flowers none. Build mode (`setEdit`) shows the grid + palette and routes clicks to the fence/hoe/erase/move APIs.
  Weather is a tinted overlay + particle emitter named `season-*` / `weather-*` (hidden during `snapshot()`, which
  zooms the camera out, grabs the canvas and crops to the world). Own garden vs friend's garden is `ownerId`.
- `HouseScene`: the `home_bg` template (1536×1024 world, camera follows) with a 17×7 furniture grid at
  `ROOM_X0/ROOM_Y0`. Furniture comes from `me().placed`; bed/desk/bookcase kinds create the E hotspots; solid kinds
  get colliders, `walk`/`rug` do not. `startPlacing(id, placedId?)` (called from the inventory or the edit-room
  menu) drives the ghost + `furnitureFits()` preview; the server re-checks. Starter pieces are `locked` and cannot be
  returned to the inventory.
- `Player`: 96×140 sheets, 12 frames: 0-1 idle down, 2-3 walk down, 4-5 idle up, 6-7 walk up, 8-9 idle side (faces
  right), 10-11 walk side; left = flipX. Diagonal input prefers the side view. All animation is frame based — never
  tween a physics sprite's `x`/`y`/`scale`.

**Assets**: `public/assets/` is generated by `tools/build_v3_assets.py` from the team sheets in `design/` (do not
hand-edit). It keys out checkerboard/white backgrounds (`tools/v3lib.py`), cuts components, and writes: 20 character
sheets + portraits, `plants/flower_1..20`, `tree_21..32`, `twig`, `fence/<piece>_<colour>` (20 pieces × 7 colours,
wood pixels recoloured by hue), `furniture/f_1..40` (the `FURNITURE` table in the script picks sheet components by
index and prints the footprint table for rules.ts), `scenes/house_ext`, `scenes/home_bg`, `scenes/soil`, `ui/map`,
`ui/spin_machine`. Only `tiles/tinytown.png` (grass, path) is third-party.

**Auth**: username + password, PBKDF2 via WebCrypto, random session token in an httpOnly cookie. Signing up with the
password `ADMIN_TEST` creates an admin (`is_admin=1`) whose starting level comes from the `level` field; admins have
unlimited currency (`publicUser()` reports 999999), instant growth, no shop rotation limits, and `/api/me/admin-level`
sets their XP to `xpForLevel(level)` — level is never special-cased, it always derives from XP.

## Gotchas

- Bash heredocs in this environment choke on apostrophes inside file content; use the Write/Edit tools for source
  files. Python scripts that read TS files need `PYTHONUTF8=1` (emoji in source).
- wrangler.jsonc must keep exactly one D1 binding named `DB`; Wrangler's interactive prompts will append a second
  entry if allowed.
- `tests/e2e_states.mjs` and `tools/seed_admins.mjs` shell out to `wrangler d1 execute`, so they need the migrations
  applied first; `e2e_states` only works against the local DB.
- Adding a user column means touching four places: a migration, `UserState` in rules.ts, `UserRow` and
  `publicUser()` in worker/index.ts, and `/api/me/settings` if it is user-editable.
- Plant ids are positional (1-20 = flower sheet row-major, 21-32 = tree sheet); reordering the catalog needs a
  migration like 0005's two-step remap (inventory has a (user, plant) primary key, so map through +100 first).
- In Playwright tests, after clicking something that re-renders a panel, wait for the re-rendered DOM (e.g. the
  `.on` class) before closing it — polling `/api/me` can observe the server change before the client's refresh, and
  the late re-render then replaces whatever panel you opened next.
- A branch/tag name with an apostrophe (e.g. `Samartha's-changes`) breaks bash quoting; alias it to a local branch
  first. `HANDOFF.md` documents that one-time merge; don't let a contributor's personal D1 id / Worker name / repo
  URL leak into config when merging.
