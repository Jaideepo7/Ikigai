// Run against Vite: npm run dev, then node tests/responsive.e2e.mjs.
// Uses local fixtures; no account or backend is required.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge' });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const state = {
  user: { id: 1, username: 'Gardener', character: 0, friend_code: 'TEST', coins: 12345, gems: 123, xp: 400,
    streak: 3, wither: 0, frozen: 0, music: 0, sfx: 0, tutorial_done: 1, season: 'summer',
    fence_color: 'brown', growth: 1, pomo_work: 25, pomo_break: 5, pomo_reps: 4, music_volume: 0 },
  plots: [], fences: [], inventory: [], cards: [], furniture: [], placed: [], folders: [],
  seasons: ['summer'], daily: { xp: 0, coins: 0, tasks_done: 0, spun: 0 }, stats: {}, tasks: [], freezesLeft: 3,
};
await page.route('**/api/**', (route) => route.fulfill({ json: route.request().url().endsWith('/api/me') ? state : {} }));
await page.routeWebSocket(/\/ws\//, () => {});

async function checkLayout() {
  await page.waitForFunction(() => {
    const canvas = document.querySelector('#game canvas')?.getBoundingClientRect();
    const host = document.querySelector('#game')?.getBoundingClientRect();
    const nav = document.querySelector('#navbar')?.getBoundingClientRect();
    return canvas && host && nav && Math.abs(host.top - nav.bottom) < 1 &&
      canvas.bottom <= innerHeight + 1 && canvas.right <= innerWidth + 1;
  });
  const layout = await page.evaluate(() => {
    const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    const nav = document.querySelector('#navbar');
    return { width: innerWidth, height: innerHeight, nav: rect(nav),
      canvas: rect(document.querySelector('#game canvas')),
      controls: [...nav.querySelectorAll('.logo, .hud, .nav-btn:not([hidden])')].map(rect) };
  });
  assert.ok(Math.abs(layout.canvas.width / layout.canvas.height - 1440 / 848) < 0.01, 'canvas keeps its aspect ratio');
  assert.ok(layout.canvas.y >= layout.nav.bottom - 1, 'canvas stays below the toolbar');
  for (const box of layout.controls) {
    assert.ok(box.x >= 0 && box.right <= layout.width + 1 && box.bottom <= layout.nav.bottom + 1, 'toolbar controls fit');
  }
}

try {
  let decorPositions;
  await page.goto(process.env.BASE || 'http://127.0.0.1:5173');
  await page.waitForFunction(() => window.__game?.scene.getScene('House')?.player?.body);
  for (const [width, height] of [[1366, 768], [1280, 720], [1024, 600], [1536, 864], [1920, 1080], [2560, 1440], [3440, 1440], [900, 600]]) {
    await page.setViewportSize({ width, height });
    await checkLayout();
    await page.click('[data-open="settings"]');
    const panel = page.locator('.panel');
    const bounds = await panel.boundingBox();
    assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= height && bounds.x >= 0 && bounds.x + bounds.width <= width, 'settings stays on screen');
    assert.ok(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), 'settings has no horizontal overflow');
    await page.click('.panel .x');
    await page.evaluate(() => window.__game.scene.getScene('House').scene.start('Garden', { ownerId: 1, spawn: 'porch' }));
    await page.waitForFunction(() => window.__game.scene.getScene('Garden')?.player?.active);
    await checkLayout();
    const decor = await page.evaluate(() => {
      const scene = window.__game.scene.getScene('Garden');
      const gx = scene.ox + scene.gc0 * 64, gy = scene.oy + scene.gr0 * 64, size = scene.n * 64;
      return scene.children.list.filter((o) => o.name === 'garden-decor-tree').map((tree) => {
        const b = tree.getBounds();
        return { x: tree.x, y: tree.y, key: tree.texture.key,
          outside: b.right <= gx || b.left >= gx + size || b.top >= gy + size,
          insideWorld: b.left >= 0 && b.top >= 0 && b.right <= scene.worldW && b.bottom <= scene.worldH };
      });
    });
    assert.equal(decor.length, 8, 'eight decorative trees');
    assert.equal(new Set(decor.map((t) => t.key)).size, 2, 'both reference styles are present');
    assert.ok(decor.every((t) => t.outside && t.insideWorld), 'trees stay outside plots and within world edges');
    if (decorPositions) assert.deepEqual(decor, decorPositions, 'decor stays stable across visits and screen sizes');
    decorPositions = decor;
    await page.evaluate(() => window.__game.scene.getScene('Garden').scene.start('House', {}));
    await page.waitForFunction(() => window.__game.scene.getScene('House')?.player?.active);
    console.log(`PASS ${width}x${height}: canvas, toolbar, settings, garden transition`);
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
