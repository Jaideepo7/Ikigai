# Ikigai

**Your garden only grows when you do.** A retro, top-down productivity game: finish real tasks, earn XP and coins,
grow a pixel garden, and visit friends' gardens in real time.

Live stack: Phaser 3 + TypeScript + Vite on the client, one Cloudflare Worker (Hono) with D1 (SQLite) for data and
a Durable Object per garden for realtime WebSockets. Everything runs on the Cloudflare free plan.

## Play loop

| Loop | How |
| --- | --- |
| Tasks | Task Book (`T`). Name, description, difficulty (1-3 stars), estimate (0-30m, 30m-1h, 1-3h exact, 3-5h slider). Complete = XP + coins. |
| Rewards | `XP = base[diff] × (1 + minutes/60) × timing`, coins = XP/2. Base 10/20/35. Timing: within ±20% of estimate = 1.0, rushed = 0.9, over = linear down to 0.5 at 2×. Daily cap 600 XP / 300 coins. |
| Pomodoro | `P`, or ▶ on a task (single countdown of the estimate). A task finished after a focus session pays **2× XP**. Sessions go to lifetime stats. |
| Streak | One task a day keeps it. Daily spin (shop) pays `50 + 10×streak` coins (max +200) with gem chances. Miss a day: streak resets. Miss two: garden withers one step per day (visibly greys). Complete tasks to revive. |
| Freeze | Settings → Freeze garden: icy overlay, no withering, streak safe. |
| Level | XP to next = `100 × 1.2^(level-1)`, max 20. Each level adds a ring to the garden (8×8 → 24×24 tiles) and unlocks 2 more plots. |
| Garden | Walk onto a tile, `E`: dig a plot (4 free, then coins), plant a seed, feed it (20/40/80 coins) to start a 1h / 4h / 12h growth timer through 4 stages. |
| Shop | `Q`. Seeds (rare ones appear after you pull one from the 60-coin lootbox), gems (150 coins), animal cards (gems), daily spin. |
| Cards | 12 collectable animal cards. Display them in the case in your house (`E` by the bookshelf). 6 slots, +2 every 5 levels. |
| Friends | Walk right out of the house (or Map → Friends' Gardens). Add by 6-letter code, accept requests, see who is online, **Visit** to walk around their garden together. `Enter` to chat with speech bubbles and a typing indicator. |

Keys: WASD / arrows move · `Shift` run · `E` interact (bed = sleep summary, desk = task book, bookshelf = card case, garden tile = plot) · `F` wave · `Enter` chat · `P T M I Q` panels · `Esc` settings/close.

More systems: task **folders**; **2 garden freezes per month** (a frozen farm is closed: the house door asks you to unfreeze); **growth pace** setting (Quick / Normal / Patient trades feed cost for wait time); **visit approval** (a friend at your gate knocks, you let them in or not; if you are away they walk in); live-updating friends list; first-login **walkthrough** (replayable in Settings); three generated music tracks + volume.

Admin accounts for testing: `admin1` … `admin4`, password `ikigai-admin` (maxed level, 999k coins, all seeds and cards). Create them with `node tools/seed_admins.mjs [--remote]`.

## Repository layout

```text
design/            mockups + sprite sheets from the team; design/third_party/ = CC0 tilesets (Kenney Tiny Town, ArMM1998 Zelda-like)
tools/build_chars.py      character sheets (12 frames, 96x140) + portraits + pixel icons from design/
tools/extract_assets.py   plant sprites, cards, map, landing art from the mockups
tools/seed_admins.mjs     admin1..admin4 test accounts
public/assets/     generated sprites, tiles, icons, cards, map
src/shared/rules.ts       ALL game numbers + catalogs, shared by client and Worker
src/game/          Phaser: Boot, HouseScene (static room), GardenScene (procedural, grows with level), Player, net (WS)
src/ui/            navbar + every panel (panels.ts), landing/auth/select screens, WebAudio sfx + music
worker/index.ts    Hono API (auth, tasks, plots, shop, friends) + static assets
worker/garden-room.ts     Durable Object: one realtime room per garden owner
migrations/        D1 schema
tests/             rules unit tests, API smoke test, Playwright e2e + state screenshots
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
npm test                      # rules unit tests (node --test)
bash tests/api_smoke.sh       # against a running wrangler dev
node tests/e2e.mjs out/       # Playwright: full flow incl. two users chatting in one garden
node tests/e2e_states.mjs out/   # level-up garden, withering, frozen, card case, rollover math
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
* **Art changes**: drop files in `design/`, adjust `tools/extract_assets.py`, run it, commit `public/assets/`.
  Card art: put `card_<id>.png` in `public/assets/cards/` and set `art: true` in `src/shared/rules.ts`.
  Music: drop `public/assets/audio/lofi.mp3`; the generated pad is the fallback.
* **Tuning**: every number lives in `src/shared/rules.ts`; unit tests in `tests/rules.test.ts` pin the intent.
* **Logs**: `npx wrangler tail`.

## Art credits

* Gardener characters, plants, cards, map and UI mockups: the Ikigai team (`design/`).
* Garden tiles: [Kenney Tiny Town](https://kenney.nl/assets/tiny-town) (CC0).
* House interior + crop stages: [Zelda-like tilesets and sprites](https://opengameart.org/content/zelda-like-tilesets-and-sprites) by ArMM1998 (CC0).

## Known simplifications

* No side-view character art exists, so left/right use a synthesized walk from the front sprite (leg shuffle + flip). Drop side sheets in `design/` and extend `tools/build_chars.py`.
* 8 of 12 cards have placeholder art (emoji + name) until PNGs are supplied.
* Auth is username + password (PBKDF2, httpOnly cookie sessions). No rate limiting or email recovery.
* The app is trust-based: task timing and completion are self-reported by design.
* Timezone comes from the browser (`x-tz` header); "today" is the user's local day.
