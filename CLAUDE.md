# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Ikigai: a retro top-down productivity game (Phaser 3 + TypeScript + Vite client, one Cloudflare Worker backend with
Hono, D1, and a Durable Object per garden for realtime). Hackathon project, deployed at
https://ikigai.jaideeep-prabish.workers.dev. Full feature description and play loop are in README.md.

## Commands

```bash
npm run build                                    # vite build -> dist/ (the Worker serves dist/ as static assets)
npx wrangler d1 migrations apply ikigai --local  # once, creates the local SQLite DB in .wrangler/
npx wrangler dev                                 # http://localhost:8787 — API + game, serves the last `npm run build`
npm run dev                                      # vite on :5173 with HMR, proxies /api and /ws to wrangler on :8787
npm run typecheck                                # two tsconfigs: client (DOM lib) and worker (workers-types); they must stay separate
npm test                                         # rules unit tests (node --test, runs .ts directly on Node 22)
bash tests/api_smoke.sh                          # full API flow with curl against a running wrangler dev
node tests/e2e.mjs out/                          # Playwright: two users, chat in one garden; BASE=<url> to hit production
node tests/e2e_states.mjs out/                   # level-up garden, wither, frozen, card case; edits local D1 via wrangler
npm run deploy                                   # vite build + wrangler deploy
npx wrangler d1 migrations apply ikigai --remote # after adding migrations/000N_*.sql
python tools/extract_assets.py                   # regenerate public/assets/ from design/ (needs Pillow + numpy; set PYTHONUTF8=1 on Windows)
```

The e2e scripts need a built `dist/` and a running `wrangler dev`. After changing client code, run `npm run build` before
re-running them (wrangler serves dist/, not src/).

## Architecture

**One source of truth for numbers**: `src/shared/rules.ts` holds every tunable (reward formula, level curve, garden
size per level, plot/feed prices, stage timers, spin payouts, plant and card catalogs, day/timezone helpers) and the
shared API types. It is imported by both the client and the Worker; `tests/rules.test.ts` pins the intended values.
Change balance there, nowhere else.

**Worker (`worker/index.ts`)**: Hono app. `/api/auth/*` is public; everything else under `/api/*` goes through a
middleware that loads the session user from the `sid` cookie and runs `rollover()` — the day-boundary logic that
breaks streaks and withers the garden for missed days. "Today" is computed from the `x-tz` header the client sends
(browser `getTimezoneOffset()`), so all day math is in the user's local day. Plot growth timers are settled lazily
(`settlePlots`) on every read. The Worker also serves `dist/` via the ASSETS binding with SPA fallback;
`run_worker_first` in wrangler.jsonc limits the Worker to `/api/*` and `/ws/*`.

**Realtime (`worker/garden-room.ts`)**: `GardenRoom` Durable Object, one per garden owner (`idFromName(ownerId)`),
using the WebSocket hibernation API. Peer state lives in socket attachments. It relays move/chat/typing, writes
presence (`users.location`, `last_seen`) to D1 on join/leave, and refreshes `last_seen` via an alarm so the friends
list can show "online". The `/ws/garden/:id` route authenticates and checks friendship before forwarding.

**Client state**: `src/state.ts` is the whole store: `store.me` (the `/api/me` payload), `refreshMe()`, and an
`EventTarget` bus. Every mutation calls `refreshMe()`; the navbar HUD and the active Phaser scene re-render on the `me`
event (scenes implement `onMe()`). There is no other state layer.

**UI vs game**: all panels (tasks, pomodoro, map, inventory, shop, settings, friends, plot dialog, card case) are HTML
strings in `src/ui/panels.ts` rendered into `#overlay` above the Phaser canvas; `openPanel()` enforces one panel at a
time and `isPanelOpen()` is how scenes freeze movement. User-supplied strings must go through `esc()` before
`innerHTML`. The Pomodoro engine is module state in panels.ts (survives panel close; mini widget appears when closed).
Global hotkeys live in `mountNavbar()`.

**Scenes (`src/game/`)**: `HouseScene` is the mockup image plus hand-placed collision rectangles (coordinates are in
the 1440x848 scene space; exits are edge triggers). `GardenScene` is procedural: an N×N tile grid from
`gardenTiles(level)` with facade, fence, and decor built at runtime; it hosts both your own garden (plot interaction
with E) and friends' gardens (read-only) and owns the `Net` WebSocket client and the chat input. `Player` frames are
0 front, 1 back, 2–5 back-walk; there is no side art, so left/right mirror the front frame. Never tween a physics
sprite's `x`/`y` (it cancels arcade velocity) — the bob tweens `originY` instead.

**Assets**: `public/assets/` is generated, not hand-edited. `tools/extract_assets.py` crops sprites, scenes, icons,
and cards out of the team mockups in `design/` (paints the character out of the house image, builds character
spritesheets, keys the plant sheet, generates the grass and flower tiles). Edit the script and re-run it; commit the
outputs.

**Auth**: username + password, PBKDF2 via WebCrypto, random session token in an httpOnly cookie, sessions table in
D1. No third-party auth.

## Gotchas

- Bash heredocs in this environment choke on apostrophes inside file content; use the Write/Edit tools for source
  files. Python scripts that read TS files need `PYTHONUTF8=1` (emoji in source).
- wrangler.jsonc must keep exactly one D1 binding named `DB`; Wrangler's interactive prompts will append a second
  entry if allowed.
- `tests/e2e_states.mjs` shells out to `wrangler d1 execute --local`, so it only works against the local DB.
