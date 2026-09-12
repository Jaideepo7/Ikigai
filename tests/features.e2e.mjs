// Public browser and API checks for the feature repair work.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.BASE || 'http://localhost:8787';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 912 } });
const password = 'ADMIN_TEST';

await page.goto(base);
await page.click('[data-go="signup"]');
const adminName = `admin_${Date.now().toString().slice(-7)}`;
await page.fill('input[name="username"]', adminName);
await page.fill('input[name="password"]', password);
await page.fill('input[name="verify"]', password);
await page.click('button.btn-round');
await page.waitForSelector('.char-tile, #navbar');
if (await page.locator('.char-tile').count()) {
  await page.click('.char-tile[data-char="0"]');
  await page.click('#c-yes');
}
await page.waitForSelector('#navbar');
await page.waitForTimeout(1600);
if (await page.locator('#t-skip').count()) await page.click('#t-skip');

assert.equal(await page.locator('#navbar [title="Coins"], #navbar [title="Gems"]').count(), 0);
let state = await page.evaluate(() => fetch('/api/me').then((r) => r.json()));
assert.equal(state.user.is_admin, 1);
assert.equal(state.user.xp, 999999);
await page.keyboard.press('p');
await page.click('#p-start');
await page.click('.panel .x');
await page.keyboard.press('m');
await page.click('.hotspot[data-to="garden"]');
await page.waitForTimeout(200);
assert.equal(await page.evaluate(() => window.__game.scene.getScenes(true)[0]?.scene.key), 'House');
await page.click('#mini-timer');
await page.click('#p-reset');
await page.click('.panel .x');
await page.keyboard.press('q');
await page.waitForSelector('.shop-shell');
assert.equal(await page.locator('[data-currency]').count(), 2);
assert.equal(await page.locator('.shop-tabs [data-t="furniture"]').count(), 1);
assert.equal(await page.locator('.shop-tabs [data-t="seasons"]').count(), 1);
await page.click('[data-t="cards"]');
await page.waitForSelector('.shop-card-item');
assert.equal(await page.locator('.shop-card-item').count(), 12);
const cardBackgrounds = await page.locator('.shop-card-item').evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundColor));
assert.ok(cardBackgrounds.every((color) => color !== 'rgba(0, 0, 0, 0)'));

await page.click('[data-t="furniture"]');
await page.waitForSelector('[data-furniture-buy="1"]');
await page.click('[data-furniture-buy="1"]');
await page.waitForFunction(() => fetch('/api/me').then((r) => r.json()).then((m) => m.furniture.some((f) => f.furniture_id === 1)));

await page.click('[data-t="seasons"]');
await page.waitForSelector('[data-season-buy="winter"]');
await page.click('[data-season-buy="winter"]');
await page.waitForTimeout(250);
state = await page.evaluate(() => fetch('/api/me').then((r) => r.json()));
assert.ok(state.seasons.includes('winter'));
assert.equal(state.user.season, 'auto');
assert.equal(state.user.gems, 999999);

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

await page.keyboard.press('Escape');
await page.keyboard.press('i');
await page.click('[data-t="furniture"]');
await page.waitForSelector('.furniture-item select');
await page.selectOption('.furniture-item select', '0');
await page.waitForFunction(() => fetch('/api/me').then((r) => r.json()).then((m) => m.furniture.some((f) => f.furniture_id === 1 && f.slot === 0)));
await page.click('[data-t="seasons"]');
await page.waitForSelector('[data-inventory-season="winter"]');
await page.click('[data-inventory-season="winter"]');
await page.waitForFunction(() => fetch('/api/me').then((r) => r.json()).then((m) => m.user.season === 'winter'));
await page.click('.panel .x');
assert.equal(await page.evaluate(() => window.__game.scene.getScenes(true)[0].children.getByName('room-furniture-0')?.name), 'room-furniture-0');

await page.keyboard.press('t');
await page.click('#add-folder');
assert.equal(await page.locator('#folder-name').count(), 1);
await page.click('.panel .x');
await page.keyboard.press('m');
await page.waitForSelector('.map-img');
const mapPos = await page.locator('.hotspot[data-to]').evaluateAll((els) => els.map((el) => [el.style.left, el.style.top]));
assert.deepEqual(mapPos, [['50%', '35%'], ['19%', '57%'], ['86%', '57%']]);
await page.click('.hotspot[data-to="garden"]');
await page.waitForFunction(() => window.__game.scene.getScenes(true)[0]?.scene.key === 'Garden');
assert.equal(await page.evaluate(() => window.__game.scene.getScenes(true)[0].children.getByName('season-winter')?.name), 'season-winter');

const plot = await page.evaluate(async () => {
  await fetch('/api/plots/buy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tx: 0, ty: 0 }) });
  const before = await fetch('/api/me').then((r) => r.json());
  const p = before.plots.find((x) => x.tx === 0 && x.ty === 0);
  await fetch(`/api/plots/${p.id}/plant`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plant_id: 16 }) });
  return fetch('/api/me').then((r) => r.json()).then((m) => m.plots.find((x) => x.id === p.id));
});
assert.equal(plot.plant_id, 16);
assert.equal(plot.stage, 3);

const hasSideAnimation = await page.evaluate(() => window.__game.anims.exists('walk_side_0'));
assert.equal(hasSideAnimation, true);

console.log('feature checks passed');
await browser.close();
