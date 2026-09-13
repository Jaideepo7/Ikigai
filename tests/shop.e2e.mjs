import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
const state = { user: { id: 1, username: 'Gardener', character: 0, friend_code: 'TEST', coins: 12345, gems: 123, xp: 400, streak: 3, wither: 0, frozen: 0, music: 0, sfx: 0, tutorial_done: 1, season: 'summer', fence_color: 'brown', growth: 1, pomo_work: 25, pomo_break: 5, pomo_reps: 4, music_volume: 0 }, plots: [], fences: [], inventory: [], cards: [], furniture: [{ furniture_id: 23, qty: 1 }, { furniture_id: 1, qty: 1 }], placed: [], folders: [], seasons: ['summer'], daily: { xp: 0, coins: 0, tasks_done: 0, spun: 1 }, stats: {}, tasks: [], freezesLeft: 3 };
let requests = 0, resetTest = false, delayed = false, release;
await page.route('**/api/**', async route => {
 const url = new URL(route.request().url());
 if (url.pathname === '/api/shop') {
  requests++; if (delayed) await new Promise(r => release = r);
  return route.fulfill({ json: { plants: [1, 11, 12, 16], furniture: requests % 2 ? [1, 2, 5, 7] : [3, 4, 6, 8], outdoor: [21, 23, 24, 26], card: 2, ownedCards: [], collected: [], daily: { spun: 1 }, serverNow: Date.now(), resetAt: Date.now() + (resetTest ? 2200 : 3600000) } });
 }
 if (url.pathname === '/api/furniture/place') { const body = route.request().postDataJSON(); state.placed.push({ id: 20, ...body, locked: 0, location: 'garden' }); return route.fulfill({ json: { ok: true, id: 20 } }); }
 return route.fulfill({ json: url.pathname === '/api/me' ? state : {} });
});
await page.routeWebSocket(/\/ws\//, () => {});
const open = tab => page.evaluate(async tab => (await import('/src/ui/panels.ts')).shopPanel(tab), tab);
try {
 await page.goto('http://127.0.0.1:5173');
 await page.waitForFunction(() => window.__game?.scene.getScene('House')?.player?.body);
 await open('indoor');
 for (const [width, height] of [[1024, 600], [1366, 768], [1920, 1080], [900, 700], [600, 700], [390, 844], [320, 568]]) {
  await page.setViewportSize({ width, height });
  for (const tab of ['shop', 'indoor', 'outdoor', 'seasons']) {
   await open(tab); await page.evaluate(() => document.fonts.ready);
   const check = await page.evaluate(() => {
    const p = document.querySelector('.shop-panel'), shell = document.querySelector('.shop-shell'); const r = p.getBoundingClientRect();
    const fit = (a,b) => b.left >= a.left - 1 && b.right <= a.right + 1 && b.top >= a.top - 1 && b.bottom <= a.bottom + 1;
    if (!fit(r, shell.getBoundingClientRect())) throw new Error('Shop scroll area is clipped by the panel');
    return { screen: r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1, overflow: shell.scrollWidth <= shell.clientWidth + 1, art: [...document.querySelectorAll('.market-art img')].every(el => fit(el.parentElement.getBoundingClientRect(),el.getBoundingClientRect())), spin: fit(document.querySelector('.spin-box').getBoundingClientRect(),document.querySelector('.machine').getBoundingClientRect()) };
   });
   assert.deepEqual(check, { screen: true, overflow: true, art: true, spin: true }, `${tab} ${width}x${height}`);
  }
 }
 await page.setViewportSize({ width: 1366, height: 768 }); await open('outdoor');
 await page.screenshot({ path: 'out/shop-redesign.png' });
 resetTest = true; await open('indoor'); const before = requests;
 const stock = await page.locator('[data-furniture-buy]').evaluateAll(els => els.map(e => e.dataset.furnitureBuy));
 const first = await page.locator('[data-shop-countdown]').textContent();
 await page.waitForTimeout(1100); assert.notEqual(await page.locator('[data-shop-countdown]').textContent(), first);
 resetTest = false; await page.waitForFunction(n => document.querySelector('[data-shop-countdown]')?.textContent.startsWith('1:'), null, { timeout: 5000 });
 assert.equal(requests, before + 1);
 assert.notDeepEqual(await page.locator('[data-furniture-buy]').evaluateAll(els => els.map(e => e.dataset.furnitureBuy)), stock);
 delayed = true; const pending = open('outdoor'); await page.waitForTimeout(300);
 await page.locator('.panel .x').click(); release(); await pending;
 assert.equal(await page.locator('.shop-panel').count(), 0); delayed = false;
 await page.evaluate(() => window.__game.scene.getScene('House').scene.start('Garden', { ownerId: 1, spawn: 'porch' }));
 await page.waitForFunction(() => window.__game.scene.getScene('Garden')?.player?.active);
 await page.evaluate(async () => (await import('/src/ui/panels.ts')).inventoryPanel('furniture'));
 assert.equal(await page.locator('[data-place="23"]').isEnabled(), true); assert.equal(await page.locator('[data-place="1"]').isEnabled(), false);
 await page.locator('[data-place="23"]').click();
 await page.evaluate(async () => { const g = window.__game.scene.getScene('Garden'); const p = g.tilePx(3, 5); await g.placeFurniture({ worldX: p.x + 64, worldY: p.y + 32 }); });
 assert.equal(state.placed.length, 1);
 assert.equal(await page.evaluate(() => window.__game.scene.getScene('Garden').children.list.filter(x => x.name === 'garden-furniture-20').length), 1);
 await page.evaluate(() => window.__game.scene.getScene('Garden').scene.start('House', { ownerId: 1, spawn: 'center' }));
 await page.waitForFunction(() => window.__game.scene.getScene('House')?.player?.active);
 assert.equal(await page.evaluate(() => window.__game.scene.getScene('House').children.list.filter(x => x.name === 'room-furniture-20').length), 0);
 assert.deepEqual(errors, []);
 console.log('PASS: four shop tabs at seven sizes, live countdown and automatic stock replacement, close during refresh, outdoor inventory and placement, no indoor duplication.');
} finally { await browser.close(); }
