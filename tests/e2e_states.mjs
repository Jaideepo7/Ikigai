// Visual checks for states that need time to pass: level growth, withering, frozen garden, card case.
// Drives the local D1 directly via wrangler, then screenshots. Usage: node tests/e2e_states.mjs [outDir]
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const OUT = process.argv[2] || 'e2e-out'; fs.mkdirSync(OUT, { recursive: true });
const sql = (q) => execSync(`npx wrangler d1 execute ikigai --local --command "${q.replace(/"/g, '\\"')}"`, { stdio: 'pipe' });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 912 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const hold = (key, ms) => page.keyboard.down(key).then(() => page.waitForTimeout(ms)).then(() => page.keyboard.up(key));
await page.goto('http://localhost:8787');
await page.click('[data-go="signup"]');
const u = `st_${Date.now() % 100000}`;
await page.fill('input[name=username]', u); await page.fill('input[name=password]', 'secret1'); await page.fill('input[name=verify]', 'secret1');
await page.click('button.btn-round'); await page.waitForSelector('.char-tile'); await page.click('.char-tile[data-char="12"]'); await page.click('#c-yes');
await page.waitForSelector('#navbar'); await page.waitForTimeout(1500);

// level 6 (12x12 garden), rich, with mature + growing plants, 2 gems worth of cards
const id = await page.evaluate(() => fetch('/api/me').then((r) => r.json()).then((d) => d.user.id));
sql(`UPDATE users SET xp=1000, coins=5000, gems=60 WHERE id=${id}`);
sql(`INSERT INTO plots (user_id,tx,ty,plant_id,stage,planted_at,ready_at) VALUES (${id},3,3,1,3,${Date.now()},NULL),(${id},5,3,29,3,${Date.now()},NULL),(${id},7,3,6,0,${Date.now() - 900000},${Date.now() + 300000}),(${id},3,5,12,3,${Date.now()},NULL),(${id},5,5,7,0,${Date.now()},${Date.now() + 1200000}),(${id},8,8,32,3,${Date.now()},NULL)`);
sql(`INSERT INTO cards (user_id,card_id,slot) VALUES (${id},0,0),(${id},2,1),(${id},3,2)`);
await page.reload(); await page.waitForSelector('#navbar'); await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/30-house-cards.png` });
if (await page.$('#t-skip')) await page.click('#t-skip');
await hold('ArrowRight', 1600); await hold('ArrowUp', 700); await page.keyboard.press('e'); await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/31-card-case.png` }); await page.keyboard.press('Escape');
await page.keyboard.press('m'); await page.waitForSelector('.hotspot'); await page.screenshot({ path: `${OUT}/32-map.png` });
await page.click('[data-to="garden"]'); await page.waitForTimeout(1500);
await hold('ArrowDown', 900);
await page.screenshot({ path: `${OUT}/33-garden-level6.png` });

// withered: missed a week
sql(`UPDATE users SET wither=3, streak=0 WHERE id=${id}`);
await page.reload(); await page.waitForSelector('#navbar'); await page.waitForTimeout(1200);
await page.keyboard.press('m'); await page.waitForSelector('.hotspot'); await page.click('[data-to="garden"]'); await page.waitForTimeout(1500); await hold('ArrowDown', 900);
await page.screenshot({ path: `${OUT}/34-garden-withered.png` });

// frozen (2 per month, confirm dialog), then the farm is closed from the house
await page.keyboard.press('Escape'); await page.waitForSelector('#freeze'); await page.click('#freeze'); await page.waitForSelector('#c-yes'); await page.click('#c-yes'); await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/35a-settings-frozen.png` }); await page.keyboard.press('Escape'); await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/35-garden-frozen.png` });
await page.keyboard.press('m'); await page.waitForSelector('.hotspot'); await page.click('[data-to="house"]'); await page.waitForTimeout(1200);
await hold('ArrowDown', 1800); await page.waitForSelector('#c-yes'); await page.screenshot({ path: `${OUT}/36-frozen-exit-dialog.png` }); await page.click('#c-no'); await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/37-house-v2.png` });

// rollover logic: last task 8 days ago, unfrozen -> wither should hit 4 and streak 0
sql(`UPDATE users SET frozen=0, wither=0, streak=5, last_task_day='2026-09-04', last_roll_day='2026-09-05' WHERE id=${id}`);
const me = await page.evaluate(() => fetch('/api/me', { headers: { 'x-tz': '300' } }).then((r) => r.json()));
console.log('after rollover: wither', me.user.wither, 'streak', me.user.streak, '(expect 4, 0)');
// missed only yesterday: streak resets, no wither yet
sql(`UPDATE users SET wither=0, streak=5, last_task_day='2026-09-10', last_roll_day='2026-09-11' WHERE id=${id}`);
const me2 = await page.evaluate(() => fetch('/api/me', { headers: { 'x-tz': '300' } }).then((r) => r.json()));
console.log('one missed day: wither', me2.user.wither, 'streak', me2.user.streak, '(expect 0, 0)');
sql(`UPDATE users SET wither=2, streak=0, frozen=1, last_task_day='2026-09-01', last_roll_day='2026-09-02' WHERE id=${id}`);
const me3 = await page.evaluate(() => fetch('/api/me', { headers: { 'x-tz': '300' } }).then((r) => r.json()));
console.log('frozen for 10 days: wither', me3.user.wither, '(expect 2, unchanged)');
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
