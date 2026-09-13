# Ikigai

**Your garden only grows when you do.** A retro, top-down productivity game: finish real tasks, earn XP and coins,
grow a pixel garden, decorate your home, and visit friends' gardens in real time.

Live stack: Phaser 3 + TypeScript + Vite on the client, one Cloudflare Worker (Hono) with D1 (SQLite) for data and
a Durable Object per user for realtime WebSockets. Everything runs on the Cloudflare free plan.

## Play loop

| Loop | How |
| --- | --- |
| Tasks | Task Book (`T`, or `E` at your desk). Name, description, folder, due date, priority, difficulty (1-3 stars), estimate. Today / Week / All views. Complete = XP + coins. |
| Rewards | `XP = base[diff] × (1 + minutes/60) × timing`, coins = XP/2. Base 10/20/35. Timing: within ±20% of estimate = 1.0, rushed = 0.9, over = linear down to 0.5 at 2×. Daily cap 600 XP / 300 coins. |
| Focus | `P`, or ▶ on a task. A task started with the timer must finish its focus session before it can be completed, then pays **2× XP**. **Garden access is disabled during an active focus session.** |
| Streak | One task a day keeps it. Daily spin (shop) pays `50 + 10×streak` coins (max +200) with gem chances. Miss a day: streak resets. Miss two: garden withers one step per day. Complete tasks to revive. |
| Freeze | Settings → Freeze garden (2 per month): no withering, streak safe, farm closed. Freezing from the garden sends you home. |
| Level | 0-100. XP to next = `100 + 25×level`. Garden = `12 + level/5` tiles per side (12×12 → 32×32); plots unlocked = `6 + level`. |
| Garden | Stand on a tile, `E`: hoe a plot (free), plant a seed, or grassify it. Plants sprout after 10 s and mature on a real timer (Quick 10 / Normal 20 / Patient 30 min for flowers, trees 2×; slower pace = bigger harvest of XP + coins). Hover a plant for its timer. |
| Build | **Edit garden**: place fences and gates (autotiled: ends, corners, junctions connect; gates open as you approach), hoe / erase tiles, move plots without losing their timer, pick one of 7 fence colours. **Snapshot** downloads a PNG of the whole garden. |
| Shop | `Q` (at home). Rotates daily per player: 4 plants, 4 furniture pieces, seasons (1 gem), and **at most one** animal card (gems, expensive). Plants and furniture can be bought many times; a bought card is marked Sold. Collection pages list all 32 plants and 4 cards. |
| Home | Buy furniture, place it from the Inventory on a 17×7 floor grid (one free tile around each piece, rugs go underneath, chairs and rugs are walkable). **Edit room** moves pieces or puts them back. Bed = sleep summary, desk = task book, bookcase = card case. |
| Friends | Door on the right (or Map → Friends). Add by 6-letter code; requests and acceptances arrive instantly as toasts. **Visit** to walk around a friend's garden together (they get a knock and let you in). `Enter` to chat with speech bubbles. |

Keys: WASD / arrows move (diagonals show the side view) · `Shift` run · `E` interact · `F` wave · `Enter` chat · `P T M I Q` panels (only `M` and `Esc` in the garden) · `Esc` settings / close / leave build mode.

Seasons: Auto follows the US calendar; owned seasons can be picked in the Inventory. Rainy = rain, Winter = snow, Fall = drifting leaves.

Admin accounts for testing: sign up with password `ADMIN_TEST` and pick a starting level (0-100); admins have unlimited coins, gems and spins, instant plant growth, and a level slider in Settings that resizes the garden. Pre-seeded ones: `admin1` … `admin4`, password `ikigai-admin` (`node tools/seed_admins.mjs [--remote]`).

## Repository layout

```text
design/            sprite sources from the team: Character_animation/c1..c20, Flower/Trees/Twig, fence, furniture, home, house, map, spin_slot
tools/build_v3_assets.py  cuts every sheet into the PNGs the game loads (chars, plants, fence x 7 colours, 40 furniture, scenes) and prints the furniture footprint table
tools/v3lib.py            background keying + connected-component helpers used by the pipeline
tools/seed_admins.mjs     admin1..admin4 test accounts
public/assets/     generated sprites (chars, plants, fence, furniture, scenes, ui, cards); tiles/ = Kenney grass + path
src/shared/rules.ts       ALL game numbers + catalogs + placement / autotile rules, shared by client and Worker
src/game/          Phaser: Boot, HouseScene (room template + furniture), GardenScene (editable grid, fences, plants, weather, snapshot), Player, net (garden WS), hub (notification WS)
src/ui/            navbar + every panel (panels.ts), landing/auth/select screens, WebAudio sfx + music
worker/index.ts    Hono API (auth, tasks, plots, fences, furniture, shop, friends) + static assets
worker/garden-room.ts     Durable Object: realtime room per garden owner + that user's notification hub
migrations/        D1 schema (0001-0005)
tests/             rules unit tests, API smoke test, Playwright e2e (two users), feature e2e, state screenshots
```

## Local development

```bash
npm install
npx wrangler d1 migrations apply ikigai --local     # creates the local SQLite DB
npm run build                                       # first build so the Worker has assets to serve
npx wrangler dev                                    # http://localhost:8787  (API + game)
```

For hot reload of the client run `npm run dev` in a second terminal and open <http://localhost:5173> (it proxies
`/api` and `/ws` to wrangler on 8787).

Tests:

```bash
npm test                          # rules unit tests (node --test)
bash tests/api_smoke.sh           # against a running wrangler dev
node tests/features.e2e.mjs       # Playwright: admin level, focus lock, shop rotation, furniture, seasons, fences
node tests/e2e.mjs out/           # Playwright: full flow incl. two users, realtime friend toasts, chat
node tests/e2e_states.mjs out/    # level-up garden, withering, frozen, card case, rollover math
npm run typecheck
```

## Deploy (Cloudflare, free plan)

```bash
npx wrangler login
npx wrangler d1 create ikigai            # copy the database_id into wrangler.jsonc
npx wrangler d1 migrations apply ikigai --remote
npm run deploy                           # vite build + wrangler deploy
```

That prints the `*.workers.dev` URL. Share it. Optional: add a custom domain in the Cloudflare dashboard → Workers → your
worker → Domains & Routes.

Sustaining it:

* **Costs**: Workers free tier = 100k requests/day, D1 free = 5M reads/day, Durable Objects (SQLite-backed) are on the
  free plan. Nothing here needs a card.
* **Schema changes**: add `migrations/000N_*.sql`, run `wrangler d1 migrations apply ikigai --remote`.
* **Art changes**: drop the new sheet in `design/`, adjust `tools/build_v3_assets.py` (`PIECES` / `FURNITURE` index tables),
  run `PYTHONUTF8=1 python tools/build_v3_assets.py`, commit `public/assets/`. New furniture also needs a row in `FURNITURE` in `rules.ts`.
  Card art: `public/assets/cards/card_<id>.png` + a row in `CARDS`.
* **Tuning**: every number lives in `src/shared/rules.ts`; unit tests in `tests/rules.test.ts` pin the intent.
* **Logs**: `npx wrangler tail`.

## Art credits

* Gardener characters, plants, trees, fences, furniture, house, home, map, spin machine and cards: the Ikigai team (`design/`).
* Grass and path tiles: [Kenney Tiny Town](https://kenney.nl/assets/tiny-town) (CC0).

## Known simplifications

* Characters have one front frame, one side frame and four back-walk frames, so walking down / sideways is the standing frame stepping up 2 px (the art itself is never altered). Idle = a 1 px breath.
* Only the four illustrated cards exist for now.
* Auth is username + password (PBKDF2, httpOnly cookie sessions). No rate limiting or email recovery.
* The app is trust-based: task timing and completion are self-reported by design.
* Timezone comes from the browser (`x-tz` header); "today" is the user's local day.
