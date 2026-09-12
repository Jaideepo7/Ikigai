# IKIGAI merge and production handoff

## Goal

Merge branch `Samartha's-changes` into the production IKIGAI `main` branch. Keep all product changes in this branch. Keep the production repository's existing Cloudflare account, Worker, D1 database, Durable Object, domains, secrets, and production data.

The Cloudflare instance at `https://ikigai.s4mbapat.workers.dev` is Samartha's personal test instance. Do not change the production repository to use its D1 database ID or its account resources.

## Product behavior that must stay

- A normal Sign Up with password `ADMIN_TEST` creates an admin test account.
- Admin accounts have unlimited coins, gems, plots, seeds, shop actions, and daily spins.
- Admin accounts always show level 20 and use the maximum 32×32 garden.
- Plants grow at once for an admin account.
- Tasks support folders, due dates, priority, a Today view, and a seven-day view.
- Task completion asks `Did you complete X?`. `Completed!` grants the reward and removes the task from the active list.
- A task started with the focus timer cannot be completed before one focus session ends.
- The user's garden is closed while a focus timer runs.
- The Shop contains seeds, animal cards, furniture, seasons, and the daily spin.
- Currency totals appear in the Shop. They do not appear in the main HUD or Inventory.
- Users buy seasons in the Shop and select owned seasons in the Seasons part of Inventory.
- Auto season follows US meteorological seasons. December through February is winter, March through May is rainy, June through August is summer, and September through November is fall.
- Summer has no color layer. Rainy uses a light cool-blue layer. Fall uses a light red layer. Winter uses a light pale-gray fog layer. The layer fades in for 300 ms.
- Users buy furniture in the Shop and place it in one of four room slots from the Furniture part of Inventory.
- The home windows show the complete four-pane tile.
- Map buttons align with the labels in the map image.
- Each of the 24 player sprites has two idle frames and two walk frames for down, up, and side views.
- Young plants use the selected plant art, so different seed types look different before they mature.
- Large garden props stay inside the world edge, so trees do not get cut off.
- Panel menus use the in-app retro menu style instead of the operating system select menu.

## Database changes

This branch adds these migrations:

- `migrations/0003_calendar_seasons_furniture.sql`
  - Adds `users.season`.
  - Adds `tasks.due_date` and `tasks.priority`.
  - Adds `furniture` and `task_folders`.
- `migrations/0004_owned_seasons.sql`
  - Adds `owned_seasons`.

Do not point the production Worker at Samartha's personal D1 database. Apply these schema changes to the production repository's existing D1 database.

If the production repository already has migration files named `0003` or `0004`, compare the SQL first. Give these two migrations the next unused numbers. Do not edit a migration that already ran in production.

## Merge procedure

1. Update the production repository's `main` branch.
2. Create a temporary integration branch from production `main`.
3. Merge `origin/Samartha's-changes` into the integration branch with `--no-commit`.
4. Keep the production repository's Cloudflare values from its original `wrangler.jsonc`. These values include the Worker name, D1 `database_id`, account settings, routes, domains, bindings, Durable Object migrations, and environment names.
5. Bring in the application code, assets, tests, and new SQL migrations from `Samartha's-changes`.
6. Keep observability logs and traces enabled if the production configuration supports them.
7. Review the final diff before the merge commit. Search for `465e79e3-d7db-4d7d-92f6-d0517359f837`. That personal D1 ID must not be present in the production configuration.

Example commands from the production repository:

```bash
git switch main
git pull origin main
git switch -c integrate-samartha-changes
git merge --no-commit --no-ff "origin/Samartha's-changes"
git restore --source=HEAD --staged --worktree wrangler.jsonc
git status
git diff --cached
```

After the `git restore` command, add any required observability fields by hand. Do not replace production resource IDs.

## Validation before production deployment

Use the production repository's Node and Wrangler versions.

```bash
npm ci
npm test
npm run typecheck
npm run build
npx wrangler deploy --dry-run
npx wrangler whoami
npx wrangler d1 migrations list <production-database-name> --remote
```

Run the local D1 migrations and browser checks before the production migration:

```bash
npx wrangler d1 migrations apply <production-database-name> --local
npx wrangler dev
node tests/features.e2e.mjs
node tests/e2e.mjs
```

Check these flows by hand:

1. Create a normal user and an admin user with `ADMIN_TEST`.
2. Confirm that the admin user is level 20 and gets a 32×32 garden.
3. Buy a season, select it in Inventory, and enter the garden.
4. Buy furniture, select a room slot, and return to the home.
5. Create and complete a normal task.
6. Start a task focus timer and confirm that early completion and garden entry are blocked.
7. Open every retro menu with a mouse and keyboard.
8. Visit a second user's garden.

## Production migration and deployment

Confirm `npx wrangler whoami` shows the production Cloudflare account. Then apply the migrations to the production D1 database and deploy with the production configuration:

```bash
npx wrangler d1 migrations apply <production-database-name> --remote
npx wrangler deploy
```

After deployment, check `/`, Sign Up, Login, `/api/me`, the Shop, Inventory, Tasks, Home, Garden, and a friend visit. A request to `/api/me` without a session must return `401`.

Merge the integration branch into production `main` only after these checks pass. Do not push `Samartha's-changes` directly to production `main`.
