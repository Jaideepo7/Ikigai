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
await page.waitForTimeout(800);
if (await page.locator('#t-skip').count()) await page.click('#t-skip');

assert.equal(await page.locator('#navbar [title="Coins"], #navbar [title="Gems"]').count(), 0);
await page.keyboard.press('q');
await page.waitForSelector('.shop-shell');
assert.equal(await page.locator('.shop-currency [data-currency]').count(), 2);
assert.equal(await page.locator('.shop-tabs [data-t="furniture"]').count(), 1);
assert.equal(await page.locator('.shop-tabs [data-t="seasons"]').count(), 1);
await page.click('[data-t="cards"]');
assert.equal(await page.locator('.shop-card-item').count(), 12);
const cardBackgrounds = await page.locator('.shop-card-item').evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundColor));
assert.ok(cardBackgrounds.every((color) => color !== 'rgba(0, 0, 0, 0)'));

await page.click('[data-t="seasons"]');
await page.click('[data-season="winter"]');
await page.waitForTimeout(250);
let state = await page.evaluate(() => fetch('/api/me').then((r) => r.json()));
assert.equal(state.user.season, 'winter');
assert.equal(state.user.gems, 999999);

await page.keyboard.press('Escape');
await page.keyboard.press('m');
const mapPos = await page.locator('.hotspot[data-to]').evaluateAll((els) => els.map((el) => [el.style.left, el.style.top]));
assert.deepEqual(mapPos, [['50%', '35%'], ['19%', '57%'], ['86%', '57%']]);
await page.keyboard.press('Escape');

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
