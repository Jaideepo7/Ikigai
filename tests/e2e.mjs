// Browser end-to-end run against `wrangler dev` (localhost:8787) after `vite build`.
// Usage: node tests/e2e.mjs [outDir]   -> writes screenshots + prints console errors.
import { chromium } from 'playwright';
import fs from 'node:fs';

const OUT = process.argv[2] || 'e2e-out';
fs.mkdirSync(OUT, { recursive: true });
const B = process.env.BASE || 'http://localhost:8787';
const errors = [];
const browser = await chromium.launch();
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });
const hold = (page, key, ms) => page.keyboard.down(key).then(() => page.waitForTimeout(ms)).then(() => page.keyboard.up(key));

async function newUser(name) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 912 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('401 (Unauthorized)')) errors.push(`[${name}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`));
  await page.goto(B);
  return page;
}

const a = await newUser('alice');
await a.waitForSelector('.hero'); await a.waitForTimeout(800); await shot(a, '01-landing');
await a.click('[data-go="signup"]');
const ua = `e2e_${Date.now() % 100000}`;
await a.fill('input[name=username]', ua); await a.fill('input[name=password]', 'secret1'); await a.fill('input[name=verify]', 'secret1');
await a.click('button.btn-round');
await a.waitForSelector('.char-tile');
await shot(a, '02-select');
await a.click('.char-tile[data-char="0"]');
await a.click('#c-yes');
await a.waitForSelector('#navbar');
await a.waitForTimeout(2500);
if (await a.$('#t-skip')) { await shot(a, '02a-tutorial'); await a.click('#t-skip'); }
await shot(a, '02b-tutorial-skipped');
await shot(a, '03-house');
// tasks
await a.keyboard.press('t'); await a.waitForSelector('#new-task'); await a.click('#new-task');
await a.fill('input[name=name]', 'Read OS chapter 4'); await a.fill('textarea[name=description]', 'Ch. 4-5 and short notes');
await a.click('#diff button[data-d="2"]'); await a.click('#time button[data-m="30-60"]');
await shot(a, '04-create-task');
await a.click('[data-start="0"]'); await a.waitForSelector('.task');
await shot(a, '05-tasks');
await a.click('.task .complete'); await a.click('#c-yes'); await a.waitForTimeout(800);
await shot(a, '06-task-done');
await a.keyboard.press('Escape');
// pomodoro
await a.keyboard.press('p'); await a.waitForSelector('#p-start'); await a.click('#p-start'); await a.waitForTimeout(600);
await shot(a, '07-pomodoro'); await a.keyboard.press('Escape'); await a.waitForTimeout(300);
await shot(a, '08-mini-timer');
await a.click('#mini-timer'); await a.click('#p-reset'); await a.keyboard.press('Escape');
// map + shop
await a.keyboard.press('m'); await a.waitForSelector('.hotspot'); await shot(a, '09-map'); await a.keyboard.press('Escape');
await a.keyboard.press('q'); await a.waitForSelector('#spin'); await a.click('#spin'); await a.waitForTimeout(2600);
await shot(a, '10-shop');
await a.click('.shop-tabs button[data-t="cards"]'); await a.waitForTimeout(300); await shot(a, '11-cards');
await a.keyboard.press('Escape');
await a.keyboard.press('i'); await a.waitForSelector('.slots'); await shot(a, '12-inventory'); await a.keyboard.press('Escape');
// walk out the door to the garden
await hold(a, 'ArrowDown', 1800); await a.waitForTimeout(900);
await shot(a, '13-garden');
await hold(a, 'ArrowDown', 1300);
await a.keyboard.press('e'); await a.waitForTimeout(400); await shot(a, '14-plot-dialog');
if (await a.$('#buy')) { await a.click('#buy'); await a.waitForTimeout(600); await a.keyboard.press('e'); await a.waitForTimeout(400); await shot(a, '15-seed-picker'); await a.click('[data-plant]'); await a.waitForTimeout(600); await a.keyboard.press('e'); await a.waitForTimeout(400); await shot(a, '16-plant-info'); if (await a.$('#feed')) await a.click('#feed'); await a.waitForTimeout(600); }
await shot(a, '17-garden-planted');
// settings
await a.keyboard.press('Escape'); await a.waitForSelector('#signout'); await shot(a, '18-settings'); await a.keyboard.press('Escape');
const codeA = await a.evaluate(() => fetch('/api/friends').then((r) => r.json()).then((d) => d.code));

// second user befriends + visits
const b = await newUser('bob');
await b.click('[data-go="signup"]');
await b.fill('input[name=username]', ua + 'b'); await b.fill('input[name=password]', 'secret1'); await b.fill('input[name=verify]', 'secret1');
await b.click('button.btn-round'); await b.waitForSelector('.char-tile'); await b.click('.char-tile[data-char="7"]'); await b.click('#c-yes'); await b.waitForSelector('#navbar'); await b.waitForTimeout(1500); if (await b.$('#t-skip')) await b.click('#t-skip');
await b.keyboard.press('m'); await b.waitForSelector('.map-img'); await b.click('.hotspot[data-to="friends"]'); await b.waitForSelector('#fadd');
await b.fill('#fcode', codeA); await b.click('#fadd'); await b.waitForTimeout(500); await shot(b, '19-friend-request');
await a.evaluate(() => fetch('/api/friends').then((r) => r.json()).then((d) => fetch('/api/friends/accept', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user_id: d.friends[0].id }) })));
await b.waitForSelector('[data-visit]', { timeout: 10000 }); await shot(b, '20-friends-online');
await b.click('[data-visit]'); await b.waitForTimeout(1500); await shot(b, '20b-bob-knocking'); await a.waitForSelector('#knock'); await shot(a, '20c-alice-knock'); await a.click('#k-yes'); await b.waitForTimeout(1500);
await hold(b, 'ArrowDown', 600);
await b.keyboard.press('Enter'); await b.waitForSelector('#chat input'); await b.type('#chat input', 'hello from bob!'); await b.waitForTimeout(400);
await shot(a, '21-alice-sees-typing');
await b.keyboard.press('Enter'); await b.waitForTimeout(600);
await shot(a, '22-alice-sees-chat'); await shot(b, '23-bob-visiting');
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
