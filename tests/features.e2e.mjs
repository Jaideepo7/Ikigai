// Browser + API checks for the v3 features: admin levels, focus lock, shop rotation, furniture placement, seasons, fences, plants.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.BASE || 'http://localhost:8787';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 912 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
process.on('uncaughtException', async (e) => { try { await page.screenshot({ path: 'out/features-failure.png' }); console.error('screenshot: out/features-failure.png'); } catch {} console.error(e); process.exit(1); });
const post = (url, body) => page.evaluate(([u, b]) => fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then(async (r) => ({ status: r.status, data: await r.json() })), [url, body]);
const meState = () => page.evaluate(() => fetch('/api/me').then((r) => r.json()));
const sceneKey = () => page.evaluate(() => window.__game.scene.getScenes(true)[0]?.scene.key);

await page.goto(base);
await page.click('[data-go="signup"]');
const adminName = `admin_${Date.now().toString().slice(-7)}`;
await page.fill('input[name="username"]', adminName);
await page.fill('input[name="password"]', 'ADMIN_TEST');
assert.equal(await page.locator('#admin-level').isHidden(), false, 'admin level field appears for ADMIN_TEST');
await page.fill('input[name="level"]', '30');
await page.fill('input[name="verify"]', 'ADMIN_TEST');
await page.click('button.btn-round');
await page.waitForSelector('.char-tile');
assert.equal(await page.locator('.char-tile').count(), 20);
await page.click('.char-tile[data-char="0"]');
await page.click('#c-yes');
await page.waitForSelector('#navbar');
await page.waitForTimeout(1600);
if (await page.locator('#t-skip').count()) await page.click('#t-skip');

let state = await meState();
assert.equal(state.user.is_admin, 1);
assert.equal(state.user.xp, 13875, 'level 30 = 13875 xp');
assert.equal(state.placed.length, 3, 'bed, desk, bookcase');
assert.equal(state.fences.length, 4 * 16 - 4, '18x18 garden ring');
assert.ok((await page.locator('#navbar .hud').innerText()).replace(/\s+/g, ' ').includes('Level 30'));

// focus lock: the garden is closed during a session, with the exact message
await page.keyboard.press('p');
await page.click('#p-start');
await page.click('.panel .x');
await page.keyboard.press('m');
await page.waitForFunction(() => document.querySelector('.map-img img')?.complete);
await page.waitForTimeout(250);
await page.click('.hotspot[data-to="garden"]');
await page.waitForFunction(() => document.querySelector('#toasts')?.textContent?.includes('Garden access is disabled during an active focus session.'));
await page.waitForTimeout(500);
assert.equal(await sceneKey(), 'House');
await page.click('#mini-timer');
await page.click('#p-reset');
await page.click('.panel .x');

// shop: 4 plants, 4 furniture, at most one card, seasons, Times New Roman digits
await page.keyboard.press('q');
await page.waitForSelector('.shop-shell');
assert.equal(await page.locator('[data-currency]').count(), 2);
assert.equal(await page.locator('[data-buy]').count(), 4);
assert.equal(await page.locator('[data-furniture-buy]').count(), 4);
assert.ok((await page.locator('[data-card]').count()) <= 1);
const numFont = await page.locator('.shop-currency .num').first().evaluate((el) => getComputedStyle(el).fontFamily);
assert.ok(/Times New Roman/.test(numFont), numFont);
const firstFurniture = Number(await page.locator('[data-furniture-buy]').first().getAttribute('data-furniture-buy'));
await page.click(`[data-furniture-buy="${firstFurniture}"]`);
await page.waitForFunction((id) => fetch('/api/me').then((r) => r.json()).then((m) => m.furniture.some((f) => f.furniture_id === id)), firstFurniture);
await page.click(`[data-furniture-buy="${firstFurniture}"]`);   // buyable many times
await page.waitForFunction((id) => fetch('/api/me').then((r) => r.json()).then((m) => m.furniture.find((f) => f.furniture_id === id)?.qty === 2), firstFurniture);
await page.click('[data-season-buy="winter"]');
await page.waitForTimeout(300);
state = await meState();
assert.ok(state.seasons.includes('winter'));
await page.click('[data-t="plants"]'); await page.waitForSelector('.collection');
assert.equal(await page.locator('.collection .shop-item').count(), 32);
await page.click('[data-t="shop"]'); await page.waitForSelector('.shop-main');
await page.click('[data-t="cards"]'); await page.waitForSelector('.collection');
assert.equal(await page.locator('.shop-card-item').count(), 4);
await page.keyboard.press('Escape');

// tasks: normal completion, focus-timer guard
const taskChecks = await page.evaluate(async () => {
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const completeTask = await post('/api/tasks', { name: 'Complete check', description: '', folder: 'Tests', due_date: new Date().toISOString().slice(0, 10), priority: 3, difficulty: 1, est_minutes: 5, start: false }).then((r) => r.json());
  const doneStatus = (await post(`/api/tasks/${completeTask.id}/complete`, {})).status;
  const focusTask = await post('/api/tasks', { name: 'Focus guard', description: '', folder: 'Tests', due_date: null, priority: 2, difficulty: 1, est_minutes: 5, start: true }).then((r) => r.json());
  const early = await post(`/api/tasks/${focusTask.id}/complete`, {});
  await post('/api/pomodoro/complete', { task_id: focusTask.id, minutes: 5 });
  const afterFocus = await post(`/api/tasks/${focusTask.id}/complete`, {});
  const latest = await fetch('/api/me').then((r) => r.json());
  return { doneStatus, earlyStatus: early.status, afterFocusStatus: afterFocus.status, taskStillShown: latest.tasks.some((t) => t.id === completeTask.id) };
});
assert.deepEqual(taskChecks, { doneStatus: 200, earlyStatus: 400, afterFocusStatus: 200, taskStillShown: false });

// furniture: inventory shows counts, placement through the API respects the gap rule, room draws it
await page.keyboard.press('i');
await page.click('[data-t="furniture"]');
await page.waitForSelector('[data-place]');
assert.ok((await page.locator('.furniture-item').first().innerText()).includes('Owned ×'));
await page.click('.panel .x');
const f = (await post('/api/furniture/place', { furniture_id: firstFurniture, cx: 4, cy: 4 }));
assert.equal(f.status, 200, JSON.stringify(f.data));
assert.equal((await post('/api/furniture/place', { furniture_id: firstFurniture, cx: 4, cy: 4 })).status, 400, 'overlap refused');
await page.evaluate(() => window.__refresh());
await page.waitForFunction((id) => window.__game.scene.getScenes(true)[0].children.getByName(`room-furniture-${id}`), f.data.id);
const bedId = state.placed.find((p) => p.furniture_id === 1).id;
assert.equal((await post(`/api/furniture/${bedId}/remove`, {})).status, 400, 'starter bed stays');
assert.equal((await post(`/api/furniture/${f.data.id}/remove`, {})).status, 200);

// season selection + garden: navbar trimmed, weather particles, fences drawn, hoe + plant (admin: instant)
await page.keyboard.press('i');
await page.click('[data-t="seasons"]');
await page.waitForSelector('[data-inventory-season="winter"]');
await page.click('[data-inventory-season="winter"]');
await page.waitForSelector('[data-inventory-season="winter"].on');   // the panel re-renders after the client refresh
assert.equal((await meState()).user.season, 'winter');
await page.click('.panel .x');
await page.keyboard.press('m');
await page.waitForFunction(() => document.querySelector('.map-img img')?.complete);
await page.click('.hotspot[data-to="garden"]');
await page.waitForFunction(() => window.__game.scene.getScenes(true)[0]?.scene.key === 'Garden');
await page.waitForTimeout(600);
const visibleNav = await page.locator('#navbar [data-open]:not([hidden])').evaluateAll((els) => els.map((e) => e.dataset.open));
assert.deepEqual(visibleNav, ['map', 'settings']);
await page.keyboard.press('t'); await page.waitForTimeout(200);
assert.equal(await page.locator('.panel').count(), 0, 'tasks hotkey disabled in the garden');
assert.equal(await page.evaluate(() => window.__game.scene.getScenes(true)[0].children.getByName('season-winter')?.name), 'season-winter');
assert.equal(await page.evaluate(() => window.__game.scene.getScenes(true)[0].children.getByName('weather-winter')?.name), 'weather-winter');
assert.equal((await post('/api/plots/hoe', { tx: 5, ty: 5 })).status, 200);
const plotId = (await meState()).plots.find((p) => p.tx === 5 && p.ty === 5).id;
assert.equal((await post(`/api/plots/${plotId}/plant`, { plant_id: 32 })).status, 200);
const plot = (await meState()).plots.find((p) => p.id === plotId);
assert.equal(plot.stage, 3, 'admin plants grow at once');
assert.equal((await post('/api/garden/fence', { tx: 6, ty: 6, kind: 'gate' })).status, 200);
assert.equal((await post('/api/garden/fence', { tx: 5, ty: 5, kind: 'fence' })).status, 400, 'no fence on a plot');
assert.equal((await post('/api/me/fence-color', { color: 'white' })).status, 200);
await page.evaluate(() => window.__refresh());
await page.waitForTimeout(800);
await page.screenshot({ path: 'out/features-garden.png' });
assert.equal(await page.evaluate(() => window.__game.anims.exists('walk_side_0')), true);
assert.equal(await page.evaluate(() => window.__game.anims.exists('idle_up_19')), true);

// admin level slider resizes the garden
assert.equal((await post('/api/me/admin-level', { level: 100 })).status, 200);
await page.waitForFunction(() => fetch('/api/me').then((r) => r.json()).then((m) => m.user.xp === 100 * 100 + (25 * 100 * 99) / 2));
await page.waitForTimeout(1500);
assert.equal((await post('/api/plots/hoe', { tx: 31, ty: 31 })).status, 200, '32x32 garden at level 100');

console.log('feature checks passed', errors.length ? errors : '');
assert.equal(errors.length, 0, errors.join('\n'));
await browser.close();
