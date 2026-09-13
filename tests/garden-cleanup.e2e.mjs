// Run against Vite. Deliberately serves legacy tree data to verify compatibility.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge' });
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const state = {
    user: { id: 1, username: 'SnowTest', character: 13, friend_code: 'TEST', coins: 1000, gems: 10, xp: 0,
      streak: 0, wither: 0, frozen: 0, music: 0, sfx: 0, tutorial_done: 1, season: 'summer', is_admin: 1,
      fence_color: 'brown', growth: 100, pomo_work: 25, pomo_break: 5, pomo_reps: 4, music_volume: 0 },
    plots: [{ id: 1, tx: 2, ty: 2, plant_id: 21, stage: 3 }, { id: 2, tx: 8, ty: 8, plant_id: 29, stage: 3 },
      { id: 3, tx: 5, ty: 5, plant_id: null, stage: 0 }],
    fences: [], inventory: [{ plant_id: 21, qty: 5 }, { plant_id: 29, qty: 3 }, { plant_id: 1, qty: 2 }],
    cards: [], furniture: [], placed: [{ id: 1, furniture_id: 1, cx: 3, cy: 1, locked: 1 }], folders: [],
    seasons: ['summer'], daily: { xp: 0, coins: 0, tasks_done: 0, spun: 0 }, stats: {}, tasks: [], freezesLeft: 3,
  };
  await page.route('**/api/**', route => route.fulfill({ json: route.request().url().endsWith('/api/shop')
    ? { plants: [1, 12, 21, 29], furniture: [], card: null, ownedCards: [], collected: [1, 21, 29], daily: { spun: 0 } }
    : state }));
  await page.routeWebSocket(/\/ws\//, () => {});
  await page.goto(process.env.BASE || 'http://127.0.0.1:5173');
  await page.waitForFunction(() => window.__game?.scene.getScene('House')?.player?.body);
  // Walk into the enlarged bed from below; stop before its visible front edge.
  await page.evaluate(() => {
    const scene = window.__game.scene.getScene('House'), bed = scene.children.getByName('room-furniture-1');
    scene.player.body.reset(bed.x, bed.y + 90);
  });
  await page.keyboard.down('ArrowUp'); await page.waitForTimeout(550); await page.keyboard.up('ArrowUp');
  assert.ok(await page.evaluate(() => {
    const s = window.__game.scene.getScene('House'), bed = s.children.getByName('room-furniture-1');
    return s.player.y > bed.y && s.player.body.width === 40;
  }), 'bed collision stops the player at its scaled front edge');
  // Stand beside the bed where its artwork overlaps the player, then walk away.
  await page.evaluate(() => {
    const s = window.__game.scene.getScene('House'), bed = s.children.getByName('room-furniture-1');
    s.player.body.reset(bed.x + bed.displayWidth / 2 + 22, bed.y - 45);
  });
  await page.waitForFunction(() => window.__game.scene.getScene('House').children.getByName('room-furniture-1').alpha === 0.4);
  await page.screenshot({ path: 'out/furniture-visibility.png' });
  await page.keyboard.press('e');
  await page.waitForSelector('.panel');
  await page.click('.panel .x');
  await page.evaluate(() => window.__game.scene.getScene('House').player.body.reset(800, 700));
  await page.waitForFunction(() => window.__game.scene.getScene('House').children.getByName('room-furniture-1').alpha === 1);
  await page.click('[data-open="inventory"]');
  assert.equal(await page.locator('.slot.seed').count(), 1, 'legacy tree seeds are hidden');
  await page.click('.panel .x');
  await page.click('[data-open="shop"]');
  await page.waitForSelector('[data-buy]');
  assert.deepEqual(await page.locator('[data-buy]').evaluateAll(items => items.map(i => Number(i.dataset.buy))), [1, 12]);
  await page.click('.panel .x');
  await page.evaluate(() => window.__game.scene.getScene('House').scene.start('Garden', { ownerId: 1, spawn: 'porch' }));
  await page.waitForFunction(() => window.__game.scene.getScene('Garden')?.player?.active);
  const garden = await page.evaluate(() => {
    const s = window.__game.scene.getScene('Garden');
    return { plants: s.view.plots.map(p => p.plant_id), decor: s.children.list.filter(o => o.name === 'garden-decor-tree').length };
  });
  assert.deepEqual(garden.plants, [null]);
  assert.equal(garden.decor, 8, 'decorative border trees remain');
  await page.evaluate(() => {
    const s = window.__game.scene.getScene('Garden');
    s.player.body.reset(s.ox + (s.gc0 + 5.5) * 64, s.oy + (s.gr0 + 5.5) * 64 + 6);
  });
  await page.keyboard.press('e');
  await page.waitForSelector('[data-plant]');
  const plantIds = await page.locator('[data-plant]').evaluateAll(items => items.map(i => Number(i.dataset.plant)));
  assert.equal(plantIds.length, 20);
  assert.ok(plantIds.every(id => id >= 1 && id <= 20), 'admin picker only offers flowers');
  assert.deepEqual(errors, []);
  console.log('PASS: scaled bed collision and fading, bed interaction, retired tree inventory/shop/plots/picker, decorative trees preserved.');
} finally { await browser.close(); }
