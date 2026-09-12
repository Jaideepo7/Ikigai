# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Ikigai: a retro top-down productivity game (Phaser 3 + TypeScript + Vite client, one Cloudflare Worker backend with
Hono, D1, and a Durable Object per garden for realtime). Hackathon project, deployed at
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
node tests/e2e.mjs out/                          # Playwright: two users, chat in one garden; BASE=<url> to hit production
node tests/e2e_states.mjs out/                   # level-up garden, wither, frozen, card case; edits local D1 via wrangler
node tools/seed_admins.mjs [--remote]            # admin1..admin4 / "ikigai-admin": maxed level, full inventory, grown plots
npm run deploy                                   # vite build + wrangler deploy
npx wrangler d1 migrations apply ikigai --remote # after adding migrations/000N_*.sql
python tools/build_chars.py                      # regenerate public/assets/chars/ (12-frame sheets + portraits) from design/
python tools/extract_assets.py                   # regenerate scene crops / grass / flower in public/assets/scenes/ (see Assets)
node tests/features.e2e.mjs out/                 # Playwright: seasons, furniture, task calendar, admin account, focus-lock
```

The e2e scripts need a built `dist/` and a running `wrangler dev`. After changing client code, run `npm run build` before
re-running them (wrangler serves dist/, not src/). Python tools need Pillow + numpy and `PYTHONUTF8=1` on Windows.

## Architecture

**One source of truth for numbers**: `src/shared/rules.ts` holds every tunable (reward formula, level curve, garden
size per level, plot/feed prices, stage timers, growth-pace options, freezes per month, spin payouts, plant and card
catalogs, day/timezone helpers) and the shared API types. It is imported by both the client and the Worker;
`tests/rules.test.ts` pins the intended values. Change balance there, nowhere else.

**Worker (`worker/index.ts`)**: Hono app. `/api/auth/*` is public; everything else under `/api/*` goes through a
middleware that loads the session user from the `sid` cookie and runs `rollover()` — the day-boundary logic that
breaks streaks and withers the garden for missed days. "Today" is computed from the `x-tz` header the client sends
(browser `getTimezoneOffset()`), so all day math is in the user's local day. Plot growth timers are settled lazily
(`settlePlots`) on every read; feed cost and timer length are scaled by the user's `growth` setting (`growthCost` /
`growthMs`). Freezing is rationed per calendar month (`freezes_used` / `freeze_month`, `/api/me/freeze`); a frozen
user is blocked from entering their own garden client-side (`goto()` in `src/game/index.ts`). The Worker also serves
`dist/` via the ASSETS binding with SPA fallback; `run_worker_first` in wrangler.jsonc limits the Worker to `/api/*`
and `/ws/*`.

**Realtime (`worker/garden-room.ts`)**: `GardenRoom` Durable Object, one per garden owner (`idFromName(ownerId)`),
using the WebSocket hibernation API. Peer state lives in socket attachments, including a `pending` flag: when the
owner is present, a visitor joins as pending, the owner gets a `knock` and answers with `visit {accept}`; pending
peers receive nothing and are not broadcast. If the owner is absent (or leaves), visitors are admitted immediately.
It relays move/chat/typing/emote, writes presence (`users.location`, `last_seen`) to D1 on join/leave, and refreshes
`last_seen` via an alarm so the friends list can show "online". The `/ws/garden/:id` route authenticates and checks
friendship before forwarding.

**Client state**: `src/state.ts` is the whole store: `store.me` (the `/api/me` payload), `refreshMe()`, and an
`EventTarget` bus. Every mutation calls `refreshMe()`; the navbar HUD and the active Phaser scene re-render on the `me`
event (scenes implement `onMe()`). There is no other state layer.

**UI vs game**: all panels (tasks, pomodoro, map, inventory, shop, settings, friends, plot dialog, card case, sleep,
tutorial, knock prompt, confirm dialog) are HTML strings in `src/ui/panels.ts` rendered into `#overlay` above the
Phaser canvas; `openPanel()` enforces one panel at a time and `isPanelOpen()` is how scenes freeze movement.
User-supplied strings must go through `esc()` before `innerHTML`. The Pomodoro engine is module state in panels.ts
(survives panel close; mini widget appears when closed). Global hotkeys live in `mountNavbar()`. Music track/volume
live on the user row and are applied at boot from `src/ui/audio.ts`.

**Scenes (`src/game/`)**: both scenes are built from 16px tilesheets drawn at 4x (`src/game/tiles.ts` holds the
frame-index maps for the Kenney Tiny Town sheet `TT` and the Zelda-like interior sheet `INNER`, plus `layerFrom` /
`tile` / `solidRect` helpers). `HouseScene` is a 20×12 interior with E hotspots (bed = sleep, desk = task book,
bookshelf = card case) and door exits (bottom = garden, right = friends). `GardenScene` is procedural: an N×N fenced
grid from `gardenTiles(level)` with the house above it and decor outside the fence; it hosts both your own garden
(plot interaction with E) and friends' gardens (read-only) and owns the `Net` WebSocket client, the chat input, and the
knock/waiting overlays. Controls: WASD/arrows, Shift = run, F = wave emote, Enter = chat.

`Player` sheets are 96×140, 12 frames, two idle + two walk per direction: 0–1 idle down, 2–3 walk down, 4–5 idle up,
6–7 walk up, 8–9 idle side, 10–11 walk side (left is the side frames with `flipX`). All animation is frame based —
never tween a physics sprite's `x`/`y`/`scale` (it cancels arcade velocity and blurs pixels).

**Seasons**: `users.season` (`'auto' | 'summer' | 'rainy' | 'fall' | 'winter'`) plus an `owned_seasons` table bought
in the Shop and picked in `/api/me/season`. `auto` maps the real month to a season via `effectiveSeason()` in
rules.ts (US meteorological seasons, spring folded into `rainy`). `GardenScene.applySeason()` is a single tinted
full-screen rectangle faded in over 300ms — there is no separate art per season — and `onMe()` restarts the scene
when the effective season changes (same trick as a level-up moving the fence).

**Furniture**: a `furniture` table (`furniture_id`, nullable `slot`) with `FURNITURE`/`FURNITURE_SLOTS` in rules.ts.
Bought in the Shop, placed into one of 4 fixed room positions in `HouseScene.drawFurniture()` via
`/api/furniture/:id/place`; each `kind` (`plant`/`chair`/`dresser`/`rug`/`bookcase`/`sideboard`) maps to an `INNER`
tile block.

**Tasks**: folders now persist server-side in `task_folders` (upserted whenever a task is filed into a
non-empty folder) so the folder list survives an empty folder. `due_date` (`YYYY-MM-DD` or null) and `priority`
(1–3) sort the task list; `meResponse` only returns incomplete tasks now (no more 7-day completed-task lookback).
Starting a task via `/api/tasks/:id/start` is specifically "start the focus timer" — `POST /api/tasks/:id/complete`
rejects a started-but-not-pomodoro'd task with "Finish the focus session before you complete this task"
(`/api/pomodoro/complete` sets `tasks.pomodoro=1`). The garden is also closed while a focus session is running
(`isPomodoroActive()` in panels.ts, checked in `goto()` and both scenes' `update()`).

**Admin accounts**: signing up with password `ADMIN_TEST` sets `users.is_admin=1`. `publicUser()` reports
999999 coins/gems/xp for admins; every paid/limited action (plots, planting, feeding, shop, spins, card
placement, daily cap) checks `u.is_admin` and skips the cost/limit inline rather than branching the route.
Admins are always level 20 with the max 32×32 garden. This is separate from `tools/seed_admins.mjs`'s
`admin1..admin4`, which seed a *normal* maxed-out account by editing D1 directly rather than via this flag.

**Assets**: `public/assets/` is generated, not hand-edited. `tools/build_chars.py` owns `chars/` (sheets + portraits)
and `ui/icon_*.png`. `tools/extract_assets.py` owns `scenes/` (crops, grass, flower); its character section is the
old 6-frame 72×104 format and must not overwrite `chars/` — run `build_chars.py` afterwards if you rerun it.
`public/assets/tiles/` are the third-party sheets copied from `design/third_party/` (Kenney Tiny Town, Zelda-like);
frame indices are documented in `tiles.ts`.

**Auth**: username + password, PBKDF2 via WebCrypto, random session token in an httpOnly cookie, sessions table in
D1. No third-party auth. `users.is_admin` exists but is only set by `seed_admins.mjs`.

## Gotchas

- Bash heredocs in this environment choke on apostrophes inside file content; use the Write/Edit tools for source
  files. Python scripts that read TS files need `PYTHONUTF8=1` (emoji in source).
- wrangler.jsonc must keep exactly one D1 binding named `DB`; Wrangler's interactive prompts will append a second
  entry if allowed.
- `tests/e2e_states.mjs` and `tools/seed_admins.mjs` shell out to `wrangler d1 execute`, so they need the migrations
  applied first; `e2e_states` only works against the local DB.
- Adding a user column means touching four places: a migration, `UserState` in rules.ts, `UserRow` and
  `publicUser()` in worker/index.ts, and `/api/me/settings` if it is user-editable.
- A branch/tag name with an apostrophe (e.g. `Samartha's-changes`) breaks bash quoting in this environment; alias it
  to a local branch name first (`git branch alias-name "refs/remotes/origin/Branch's-name"`) before diffing or
  merging it.
- `HANDOFF.md` at the repo root documents the one-time merge of a contributor's personal fork/Cloudflare instance
  into this repo; it is history, not living guidance — don't follow it for future merges, and don't let a
  contributor's personal D1 id, Worker name, or repo URL (package.json `repository`/`bugs`/`homepage`) leak into
  this repo's config when merging their branch.
