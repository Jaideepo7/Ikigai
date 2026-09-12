import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import {
  START, DAILY_CAP, PLANTS, CARDS, LOOTBOX_WEIGHTS, LOOTBOX_PRICE, GEM_PRICE_COINS, REEL_WEIGHTS, STAGES,
  WITHER_MAX, FREEZES_PER_MONTH, GROWTH_OPTIONS, growthCost, growthMs, taskReward, levelFromXp, gardenTiles, plotsUnlocked, plotPrice, caseSlots, spinPayout, dayKey, addDays, daysBetween, weightedPick,
  type Reel, type Rarity,
} from '../src/shared/rules';

export { GardenRoom } from './garden-room';

export type Env = { DB: D1Database; GARDEN: DurableObjectNamespace; ASSETS: Fetcher };
interface UserRow {
  id: number; username: string; pass_hash: string; salt: string; friend_code: string; character: number | null;
  coins: number; gems: number; xp: number; streak: number; last_task_day: string | null; last_roll_day: string | null;
  wither: number; frozen: number; music: number; sfx: number; pomo_work: number; pomo_break: number; pomo_reps: number;
  location: string | null; last_seen: number; created_at: number;
  freezes_used: number; freeze_month: string; growth: number; tutorial_done: number; music_track: number; music_volume: number; is_admin: number;
}
type Vars = { user: UserRow; today: string };
const app = new Hono<{ Bindings: Env; Variables: Vars }>();

// ---------- helpers ----------
const enc = new TextEncoder();
const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const randomHex = (n: number) => hex(crypto.getRandomValues(new Uint8Array(n)));
async function hashPassword(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 100_000 }, key, 256));
}
function friendCode(): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return [...crypto.getRandomValues(new Uint8Array(6))].map((b) => A[b % A.length]).join('');
}
const tz = (c: { req: { header: (k: string) => string | undefined } }) => Number(c.req.header('x-tz') ?? 0) || 0;
const bad = (msg: string, status = 400) => new Response(JSON.stringify({ error: msg }), { status, headers: { 'content-type': 'application/json' } });
const isName = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_]{3,20}$/.test(s);

async function bumpStat(db: D1Database, userId: number, key: string, by = 1) {
  await db.prepare('INSERT INTO stats (user_id,key,value) VALUES (?,?,?) ON CONFLICT(user_id,key) DO UPDATE SET value=value+excluded.value').bind(userId, key, by).run();
}
async function getDaily(db: D1Database, userId: number, day: string) {
  await db.prepare('INSERT OR IGNORE INTO daily (user_id,day) VALUES (?,?)').bind(userId, day).run();
  return (await db.prepare('SELECT * FROM daily WHERE user_id=? AND day=?').bind(userId, day).first())! as { day: string; xp: number; coins: number; tasks_done: number; spun: number };
}
/** Advance growth timers that have elapsed; count plants that just matured for stats. */
async function settlePlots(db: D1Database, userId: number, now: number) {
  const matured = (await db.prepare('SELECT COUNT(*) AS n FROM plots WHERE user_id=? AND ready_at IS NOT NULL AND ready_at<=? AND stage=?').bind(userId, now, STAGES - 1).first<{ n: number }>())!.n;
  await db.prepare('UPDATE plots SET stage=stage+1, ready_at=NULL WHERE user_id=? AND ready_at IS NOT NULL AND ready_at<=?').bind(userId, now).run();
  if (matured) await bumpStat(db, userId, 'plants_grown', matured);
}
/**
 * Day rollover: for every full day that passed since we last looked, break the streak on missed days and
 * wither the garden once the user has missed two days in a row. Frozen gardens skip both.
 */
async function rollover(db: D1Database, u: UserRow, today: string) {
  if (u.last_roll_day === today) return;
  if (!u.last_roll_day) { u.last_roll_day = today; await db.prepare('UPDATE users SET last_roll_day=? WHERE id=?').bind(today, u.id).run(); return; }
  const yesterday = addDays(today, -1);
  const done = new Set((await db.prepare('SELECT day FROM daily WHERE user_id=? AND day>=? AND day<=? AND tasks_done>0').bind(u.id, u.last_roll_day, yesterday).all<{ day: string }>()).results.map((r) => r.day));
  const createdDay = dayKey(u.created_at, 0);
  for (let d = u.last_roll_day; d <= yesterday; d = addDays(d, 1)) {
    if (done.has(d) || u.frozen) continue;
    u.streak = 0;
    const since = u.last_task_day ? daysBetween(u.last_task_day, d) : daysBetween(createdDay, d) + 1;
    if (since >= 2) u.wither = Math.min(WITHER_MAX, u.wither + 1);
  }
  u.last_roll_day = today;
  await db.prepare('UPDATE users SET streak=?, wither=?, last_roll_day=? WHERE id=?').bind(u.streak, u.wither, today, u.id).run();
}
async function loadUser(db: D1Database, token: string | undefined): Promise<UserRow | null> {
  if (!token) return null;
  return db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?').bind(token).first<UserRow>();
}
function publicUser(u: UserRow) {
  const { pass_hash: _p, salt: _s, ...rest } = u;
  return rest;
}
async function meResponse(db: D1Database, u: UserRow, today: string) {
  const now = Date.now();
  await settlePlots(db, u.id, now);
  const [plots, inventory, cards, stats, tasks] = await Promise.all([
    db.prepare('SELECT id,tx,ty,plant_id,stage,ready_at FROM plots WHERE user_id=? ORDER BY id').bind(u.id).all(),
    db.prepare('SELECT plant_id,qty FROM inventory WHERE user_id=?').bind(u.id).all(),
    db.prepare('SELECT card_id,slot FROM cards WHERE user_id=?').bind(u.id).all(),
    db.prepare('SELECT key,value FROM stats WHERE user_id=?').bind(u.id).all<{ key: string; value: number }>(),
    db.prepare('SELECT * FROM tasks WHERE user_id=? AND (completed_at IS NULL OR completed_at > ?) ORDER BY completed_at IS NOT NULL, created_at DESC').bind(u.id, now - 7 * 86_400_000).all(),
  ]);
  const daily = await getDaily(db, u.id, today);
  const freezesLeft = u.freeze_month === today.slice(0, 7) ? Math.max(0, FREEZES_PER_MONTH - u.freezes_used) : FREEZES_PER_MONTH;
  return { user: publicUser(u), freezesLeft, plots: plots.results, inventory: inventory.results, cards: cards.results, daily, tasks: tasks.results, stats: Object.fromEntries(stats.results.map((r) => [r.key, r.value])) };
}

// ---------- auth ----------
app.post('/api/auth/signup', async (c) => {
  const { username, password } = await c.req.json().catch(() => ({}));
  if (!isName(username)) return bad('Username: 3-20 letters, numbers or _');
  if (typeof password !== 'string' || password.length < 6 || password.length > 128) return bad('Password must be at least 6 characters');
  if (await c.env.DB.prepare('SELECT 1 FROM users WHERE username=?').bind(username).first()) return bad('Username taken', 409);
  const salt = randomHex(16);
  const pass_hash = await hashPassword(password, salt);
  let code = friendCode();
  while (await c.env.DB.prepare('SELECT 1 FROM users WHERE friend_code=?').bind(code).first()) code = friendCode();
  const r = await c.env.DB.prepare('INSERT INTO users (username,pass_hash,salt,friend_code,coins,gems,created_at) VALUES (?,?,?,?,?,?,?)')
    .bind(username, pass_hash, salt, code, START.coins, START.gems, Date.now()).run();
  const id = r.meta.last_row_id as number;
  const seedRows = Object.entries(START.seeds).map(([pid, qty]) => c.env.DB.prepare('INSERT INTO inventory (user_id,plant_id,qty) VALUES (?,?,?)').bind(id, Number(pid), qty));
  await c.env.DB.batch(seedRows);
  return startSession(c, id);
});
app.post('/api/auth/login', async (c) => {
  const { username, password } = await c.req.json().catch(() => ({}));
  if (!isName(username) || typeof password !== 'string') return bad('Invalid username or password', 401);
  const u = await c.env.DB.prepare('SELECT * FROM users WHERE username=?').bind(username).first<UserRow>();
  if (!u || (await hashPassword(password, u.salt)) !== u.pass_hash) return bad('Invalid username or password', 401);
  return startSession(c, u.id);
});
async function startSession(c: any, userId: number) {
  const token = randomHex(32);
  await c.env.DB.prepare('INSERT INTO sessions (token,user_id,created_at) VALUES (?,?,?)').bind(token, userId, Date.now()).run();
  setCookie(c, 'sid', token, { httpOnly: true, sameSite: 'Lax', path: '/', secure: new URL(c.req.url).protocol === 'https:', maxAge: 60 * 60 * 24 * 30 });
  return c.json({ ok: true });
}
app.post('/api/auth/logout', async (c) => {
  const t = getCookie(c, 'sid');
  if (t) await c.env.DB.prepare('DELETE FROM sessions WHERE token=?').bind(t).run();
  deleteCookie(c, 'sid', { path: '/' });
  return c.json({ ok: true });
});

// ---------- authed routes ----------
app.use('/api/*', async (c, next) => {
  if (c.req.path.startsWith('/api/auth/')) return next();
  const u = await loadUser(c.env.DB, getCookie(c, 'sid'));
  if (!u) return bad('Not signed in', 401);
  const today = dayKey(Date.now(), tz(c));
  await rollover(c.env.DB, u, today);
  c.set('user', u); c.set('today', today);
  await next();
});

app.get('/api/me', async (c) => c.json(await meResponse(c.env.DB, c.get('user'), c.get('today'))));
app.post('/api/me/character', async (c) => {
  const u = c.get('user');
  const { character } = await c.req.json().catch(() => ({}));
  if (u.character !== null) return bad('Character already chosen');
  if (!Number.isInteger(character) || character < 0 || character > 23) return bad('Bad character');
  await c.env.DB.prepare('UPDATE users SET character=? WHERE id=?').bind(character, u.id).run();
  return c.json({ ok: true });
});
app.post('/api/me/settings', async (c) => {
  const u = c.get('user');
  const b = await c.req.json().catch(() => ({}));
  const pick = (k: keyof UserRow, lo: number, hi: number) => (Number.isInteger(b[k]) && b[k] >= lo && b[k] <= hi ? b[k] : u[k]);
  const growth = GROWTH_OPTIONS.some((g) => g.value === b.growth) ? b.growth : u.growth;
  const vals = { music: pick('music', 0, 1), sfx: pick('sfx', 0, 1), pomo_work: pick('pomo_work', 1, 120), pomo_break: pick('pomo_break', 1, 60), pomo_reps: pick('pomo_reps', 1, 8),
    growth, tutorial_done: pick('tutorial_done', 0, 1), music_track: pick('music_track', 0, 2), music_volume: pick('music_volume', 0, 100) };
  await c.env.DB.prepare('UPDATE users SET music=?,sfx=?,pomo_work=?,pomo_break=?,pomo_reps=?,growth=?,tutorial_done=?,music_track=?,music_volume=? WHERE id=?').bind(...Object.values(vals), u.id).run();
  return c.json(vals);
});
/** Freeze / unfreeze the garden. Freezing spends one of FREEZES_PER_MONTH; unfreezing is free. */
app.post('/api/me/freeze', async (c) => {
  const u = c.get('user'), month = c.get('today').slice(0, 7);
  const { on } = await c.req.json().catch(() => ({}));
  const used = u.freeze_month === month ? u.freezes_used : 0;
  if (on && !u.frozen) {
    if (used >= FREEZES_PER_MONTH) return bad(`No freezes left this month (${FREEZES_PER_MONTH} per month)`);
    await c.env.DB.prepare('UPDATE users SET frozen=1, freezes_used=?, freeze_month=? WHERE id=?').bind(used + 1, month, u.id).run();
    await bumpStat(c.env.DB, u.id, 'freezes');
    return c.json({ frozen: 1, freezesLeft: FREEZES_PER_MONTH - used - 1 });
  }
  if (!on && u.frozen) await c.env.DB.prepare('UPDATE users SET frozen=0 WHERE id=?').bind(u.id).run();
  return c.json({ frozen: on ? 1 : 0, freezesLeft: FREEZES_PER_MONTH - used });
});

// ---------- tasks ----------
app.post('/api/tasks', async (c) => {
  const u = c.get('user');
  const b = await c.req.json().catch(() => ({}));
  const name = typeof b.name === 'string' ? b.name.trim().slice(0, 50) : '';
  const description = typeof b.description === 'string' ? b.description.trim().slice(0, 200) : '';
  const folder = typeof b.folder === 'string' ? b.folder.trim().slice(0, 30) : '';
  const difficulty = Number(b.difficulty), est = Number(b.est_minutes);
  if (!name) return bad('Task needs a name');
  if (![1, 2, 3].includes(difficulty)) return bad('Difficulty must be 1-3');
  if (!Number.isInteger(est) || est < 5 || est > 300) return bad('Estimate must be 5-300 minutes');
  const now = Date.now();
  const r = await c.env.DB.prepare('INSERT INTO tasks (user_id,name,description,folder,difficulty,est_minutes,created_at,started_at) VALUES (?,?,?,?,?,?,?,?)')
    .bind(u.id, name, description, folder, difficulty, est, now, b.start ? now : null).run();
  await bumpStat(c.env.DB, u.id, 'tasks_created');
  return c.json(await c.env.DB.prepare('SELECT * FROM tasks WHERE id=?').bind(r.meta.last_row_id).first());
});
app.post('/api/tasks/:id/folder', async (c) => {
  const u = c.get('user');
  const folder = String((await c.req.json().catch(() => ({}))).folder ?? '').trim().slice(0, 30);
  await c.env.DB.prepare('UPDATE tasks SET folder=? WHERE id=? AND user_id=?').bind(folder, c.req.param('id'), u.id).run();
  return c.json({ ok: true });
});
app.post('/api/tasks/:id/start', async (c) => {
  const u = c.get('user');
  await c.env.DB.prepare('UPDATE tasks SET started_at=? WHERE id=? AND user_id=? AND completed_at IS NULL').bind(Date.now(), c.req.param('id'), u.id).run();
  return c.json({ ok: true });
});
app.delete('/api/tasks/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM tasks WHERE id=? AND user_id=?').bind(c.req.param('id'), c.get('user').id).run();
  return c.json({ ok: true });
});
app.post('/api/tasks/:id/complete', async (c) => {
  const u = c.get('user'), db = c.env.DB, today = c.get('today'), now = Date.now();
  const t = await db.prepare('SELECT * FROM tasks WHERE id=? AND user_id=?').bind(c.req.param('id'), u.id).first<any>();
  if (!t) return bad('No such task', 404);
  if (t.completed_at) return bad('Already completed');
  const b = await c.req.json().catch(() => ({}));
  let actual: number | null = Number.isFinite(b.actual_minutes) && b.actual_minutes > 0 ? Math.round(b.actual_minutes) : null;
  if (actual === null && t.started_at) actual = Math.max(1, Math.round((now - t.started_at) / 60_000));
  const full = taskReward(t.difficulty, t.est_minutes, actual, !!t.pomodoro);
  const daily = await getDaily(db, u.id, today);
  const xp = Math.max(0, Math.min(full.xp, DAILY_CAP.xp - daily.xp));
  const coins = Math.max(0, Math.min(full.coins, DAILY_CAP.coins - daily.coins));
  const firstToday = daily.tasks_done === 0;
  const streak = u.last_task_day === today ? u.streak : u.streak + 1;
  const wither = firstToday ? Math.max(0, u.wither - 1) : u.wither;
  const before = levelFromXp(u.xp).level, after = levelFromXp(u.xp + xp).level;
  await db.batch([
    db.prepare('UPDATE tasks SET completed_at=?, actual_minutes=?, xp_awarded=?, coins_awarded=? WHERE id=?').bind(now, actual, xp, coins, t.id),
    db.prepare('UPDATE daily SET xp=xp+?, coins=coins+?, tasks_done=tasks_done+1 WHERE user_id=? AND day=?').bind(xp, coins, u.id, today),
    db.prepare('UPDATE users SET xp=xp+?, coins=coins+?, streak=?, wither=?, last_task_day=? WHERE id=?').bind(xp, coins, streak, wither, today, u.id),
  ]);
  await Promise.all([
    bumpStat(db, u.id, 'tasks_completed'), bumpStat(db, u.id, 'xp_earned', xp), bumpStat(db, u.id, 'coins_earned', coins),
    bumpStat(db, u.id, 'minutes_worked', actual ?? t.est_minutes),
  ]);
  if (streak > (u.streak || 0)) await db.prepare('INSERT INTO stats (user_id,key,value) VALUES (?,?,?) ON CONFLICT(user_id,key) DO UPDATE SET value=MAX(value,excluded.value)').bind(u.id, 'best_streak', streak).run();
  return c.json({ xp, coins, full, capped: xp < full.xp || coins < full.coins, streak, leveledUp: after > before, level: after });
});
app.post('/api/pomodoro/complete', async (c) => {
  const u = c.get('user'), db = c.env.DB;
  const b = await c.req.json().catch(() => ({}));
  const minutes = Number.isFinite(b.minutes) ? Math.max(1, Math.min(120, Math.round(b.minutes))) : u.pomo_work;
  await Promise.all([bumpStat(db, u.id, 'pomodoros'), bumpStat(db, u.id, 'focus_minutes', minutes)]);
  if (Number.isInteger(b.task_id)) await db.prepare('UPDATE tasks SET pomodoro=1 WHERE id=? AND user_id=? AND completed_at IS NULL').bind(b.task_id, u.id).run();
  return c.json({ ok: true });
});

// ---------- garden ----------
app.get('/api/garden/:id', async (c) => {
  const me = c.get('user'), id = Number(c.req.param('id'));
  const owner = await c.env.DB.prepare('SELECT id,username,character,xp,wither,frozen FROM users WHERE id=?').bind(id).first<any>();
  if (!owner) return bad('No such garden', 404);
  if (id !== me.id && !(await c.env.DB.prepare("SELECT 1 FROM friends WHERE user_id=? AND friend_id=? AND status='accepted'").bind(me.id, id).first())) return bad('Not friends', 403);
  await settlePlots(c.env.DB, id, Date.now());
  const plots = await c.env.DB.prepare('SELECT id,tx,ty,plant_id,stage,ready_at FROM plots WHERE user_id=? ORDER BY id').bind(id).all();
  return c.json({ owner: { id: owner.id, username: owner.username, character: owner.character, level: levelFromXp(owner.xp).level, wither: owner.wither, frozen: owner.frozen }, plots: plots.results });
});
app.post('/api/plots/buy', async (c) => {
  const u = c.get('user'), db = c.env.DB;
  const { tx, ty } = await c.req.json().catch(() => ({}));
  const n = gardenTiles(levelFromXp(u.xp).level);
  if (!Number.isInteger(tx) || !Number.isInteger(ty) || tx < 0 || ty < 0 || tx >= n || ty >= n) return bad('Outside your garden');
  const owned = (await db.prepare('SELECT COUNT(*) AS n FROM plots WHERE user_id=?').bind(u.id).first<{ n: number }>())!.n;
  if (owned >= plotsUnlocked(levelFromXp(u.xp).level)) return bad('Level up to unlock more plots');
  const price = plotPrice(owned);
  if (u.coins < price) return bad(`Need ${price} coins`);
  if (await db.prepare('SELECT 1 FROM plots WHERE user_id=? AND tx=? AND ty=?').bind(u.id, tx, ty).first()) return bad('Already a plot');
  await db.batch([
    db.prepare('INSERT INTO plots (user_id,tx,ty) VALUES (?,?,?)').bind(u.id, tx, ty),
    db.prepare('UPDATE users SET coins=coins-? WHERE id=?').bind(price, u.id),
  ]);
  await bumpStat(db, u.id, 'plots_bought');
  return c.json({ ok: true, price });
});
app.post('/api/plots/:id/plant', async (c) => {
  const u = c.get('user'), db = c.env.DB;
  const { plant_id } = await c.req.json().catch(() => ({}));
  const plot = await db.prepare('SELECT * FROM plots WHERE id=? AND user_id=?').bind(c.req.param('id'), u.id).first<any>();
  if (!plot) return bad('No such plot', 404);
  if (plot.plant_id) return bad('Plot already planted');
  const inv = await db.prepare('SELECT qty FROM inventory WHERE user_id=? AND plant_id=?').bind(u.id, plant_id).first<{ qty: number }>();
  if (!inv || inv.qty < 1) return bad('No seeds of that plant');
  await db.batch([
    db.prepare('UPDATE inventory SET qty=qty-1 WHERE user_id=? AND plant_id=?').bind(u.id, plant_id),
    db.prepare('UPDATE plots SET plant_id=?, stage=0, ready_at=NULL WHERE id=?').bind(plant_id, plot.id),
  ]);
  await bumpStat(db, u.id, 'plants_planted');
  return c.json({ ok: true });
});
app.post('/api/plots/:id/feed', async (c) => {
  const u = c.get('user'), db = c.env.DB, now = Date.now();
  await settlePlots(db, u.id, now);
  const plot = await db.prepare('SELECT * FROM plots WHERE id=? AND user_id=?').bind(c.req.param('id'), u.id).first<any>();
  if (!plot || !plot.plant_id) return bad('Nothing planted here', 404);
  if (plot.stage >= STAGES) return bad('Fully grown');
  if (plot.ready_at) return bad('Already growing');
  const cost = growthCost(plot.stage, u.growth);
  if (u.coins < cost) return bad(`Need ${cost} coins`);
  const ready_at = now + growthMs(plot.stage, u.growth);
  await db.batch([
    db.prepare('UPDATE plots SET ready_at=? WHERE id=?').bind(ready_at, plot.id),
    db.prepare('UPDATE users SET coins=coins-? WHERE id=?').bind(cost, u.id),
  ]);
  await bumpStat(db, u.id, 'plants_fed');
  return c.json({ ok: true, ready_at, cost });
});
app.post('/api/plots/:id/clear', async (c) => {
  await c.env.DB.prepare('UPDATE plots SET plant_id=NULL, stage=0, ready_at=NULL WHERE id=? AND user_id=?').bind(c.req.param('id'), c.get('user').id).run();
  return c.json({ ok: true });
});

// ---------- shop ----------
app.get('/api/shop', async (c) => {
  const u = c.get('user');
  const discovered = new Set((await c.env.DB.prepare('SELECT plant_id FROM inventory WHERE user_id=?').bind(u.id).all<{ plant_id: number }>()).results.map((r) => r.plant_id));
  const owned = new Set((await c.env.DB.prepare('SELECT card_id FROM cards WHERE user_id=?').bind(u.id).all<{ card_id: number }>()).results.map((r) => r.card_id));
  return c.json({
    plants: PLANTS.filter((p) => p.rarity !== 'rare' || discovered.has(p.id)).map((p) => p.id),
    discovered: [...discovered],
    cards: CARDS.filter((k) => !owned.has(k.id)).map((k) => k.id),
    daily: await getDaily(c.env.DB, u.id, c.get('today')),
  });
});
async function addSeed(db: D1Database, userId: number, plantId: number, qty = 1) {
  await db.prepare('INSERT INTO inventory (user_id,plant_id,qty) VALUES (?,?,?) ON CONFLICT(user_id,plant_id) DO UPDATE SET qty=qty+excluded.qty').bind(userId, plantId, qty).run();
}
app.post('/api/shop/seed', async (c) => {
  const u = c.get('user'), db = c.env.DB;
  const { plant_id } = await c.req.json().catch(() => ({}));
  const p = PLANTS.find((x) => x.id === plant_id);
  if (!p) return bad('No such plant');
  if (p.rarity === 'rare' && !(await db.prepare('SELECT 1 FROM inventory WHERE user_id=? AND plant_id=?').bind(u.id, p.id).first())) return bad('Discover this plant in a lootbox first');
  if (u.coins < p.price) return bad(`Need ${p.price} coins`);
  await db.prepare('UPDATE users SET coins=coins-? WHERE id=?').bind(p.price, u.id).run();
  await addSeed(db, u.id, p.id);
  await bumpStat(db, u.id, 'seeds_bought');
  return c.json({ ok: true, plant_id: p.id });
});
app.post('/api/shop/lootbox', async (c) => {
  const u = c.get('user'), db = c.env.DB;
  if (u.coins < LOOTBOX_PRICE) return bad(`Need ${LOOTBOX_PRICE} coins`);
  const rarity = weightedPick<Rarity>(LOOTBOX_WEIGHTS);
  const pool = PLANTS.filter((p) => p.rarity === rarity);
  const p = pool[Math.floor(Math.random() * pool.length)];
  await db.prepare('UPDATE users SET coins=coins-? WHERE id=?').bind(LOOTBOX_PRICE, u.id).run();
  await addSeed(db, u.id, p.id);
  await bumpStat(db, u.id, 'lootboxes');
  return c.json({ ok: true, plant_id: p.id, rarity });
});
app.post('/api/shop/gems', async (c) => {
  const u = c.get('user');
  const qty = Math.max(1, Math.min(50, Math.round(Number((await c.req.json().catch(() => ({}))).qty) || 1)));
  const cost = qty * GEM_PRICE_COINS;
  if (u.coins < cost) return bad(`Need ${cost} coins`);
  await c.env.DB.prepare('UPDATE users SET coins=coins-?, gems=gems+? WHERE id=?').bind(cost, qty, u.id).run();
  return c.json({ ok: true, qty, cost });
});
app.post('/api/shop/card', async (c) => {
  const u = c.get('user'), db = c.env.DB;
  const { card_id } = await c.req.json().catch(() => ({}));
  const k = CARDS.find((x) => x.id === card_id);
  if (!k) return bad('No such card');
  if (await db.prepare('SELECT 1 FROM cards WHERE user_id=? AND card_id=?').bind(u.id, k.id).first()) return bad('Already owned');
  if (u.gems < k.price) return bad(`Need ${k.price} gems`);
  await db.batch([
    db.prepare('UPDATE users SET gems=gems-? WHERE id=?').bind(k.price, u.id),
    db.prepare('INSERT INTO cards (user_id,card_id) VALUES (?,?)').bind(u.id, k.id),
  ]);
  await bumpStat(db, u.id, 'cards_collected');
  return c.json({ ok: true });
});
app.post('/api/shop/spin', async (c) => {
  const u = c.get('user'), db = c.env.DB, today = c.get('today');
  const daily = await getDaily(db, u.id, today);
  if (daily.spun) return bad('Already spun today');
  const reels: Reel[] = [weightedPick(REEL_WEIGHTS), weightedPick(REEL_WEIGHTS), weightedPick(REEL_WEIGHTS)];
  const pay = spinPayout(reels, u.streak);
  await db.batch([
    db.prepare('UPDATE daily SET spun=1 WHERE user_id=? AND day=?').bind(u.id, today),
    db.prepare('UPDATE users SET coins=coins+?, gems=gems+? WHERE id=?').bind(pay.coins, pay.gems, u.id),
  ]);
  await Promise.all([bumpStat(db, u.id, 'spins'), bumpStat(db, u.id, 'gems_won', pay.gems)]);
  return c.json({ reels, ...pay });
});
app.post('/api/cards/:id/place', async (c) => {
  const u = c.get('user'), db = c.env.DB;
  const { slot } = await c.req.json().catch(() => ({}));
  const id = Number(c.req.param('id'));
  if (!(await db.prepare('SELECT 1 FROM cards WHERE user_id=? AND card_id=?').bind(u.id, id).first())) return bad('Not owned', 404);
  if (slot !== null && (!Number.isInteger(slot) || slot < 0 || slot >= caseSlots(levelFromXp(u.xp).level))) return bad('No such slot');
  await db.batch([
    db.prepare('UPDATE cards SET slot=NULL WHERE user_id=? AND slot=?').bind(u.id, slot ?? -1),
    db.prepare('UPDATE cards SET slot=? WHERE user_id=? AND card_id=?').bind(slot, u.id, id),
  ]);
  return c.json({ ok: true });
});

// ---------- friends ----------
app.get('/api/friends', async (c) => {
  const u = c.get('user'), now = Date.now();
  const rows = await c.env.DB.prepare(`
    SELECT o.id, o.username, o.character, o.location, o.last_seen, f.status, f.user_id AS requester
    FROM friends f JOIN users o ON o.id = CASE WHEN f.user_id=? THEN f.friend_id ELSE f.user_id END
    WHERE (f.user_id=? AND f.status IN ('accepted','pending')) OR (f.friend_id=? AND f.status='pending')`).bind(u.id, u.id, u.id).all<any>();
  const seen = new Set<number>();
  const friends = rows.results.filter((r) => !seen.has(r.id) && seen.add(r.id)).map((r) => ({
    id: r.id, username: r.username, character: r.character,
    status: r.status === 'accepted' ? 'accepted' : r.requester === u.id ? 'outgoing' : 'incoming',
    online: !!r.location && now - r.last_seen < 120_000, location: r.location,
  }));
  return c.json({ friends, code: u.friend_code });
});
app.post('/api/friends/request', async (c) => {
  const u = c.get('user'), db = c.env.DB;
  const code = String((await c.req.json().catch(() => ({}))).code ?? '').trim().toUpperCase();
  const o = await db.prepare('SELECT id FROM users WHERE friend_code=?').bind(code).first<{ id: number }>();
  if (!o) return bad('No gardener with that code', 404);
  if (o.id === u.id) return bad('That is your own code');
  if (await db.prepare('SELECT 1 FROM friends WHERE (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?)').bind(u.id, o.id, o.id, u.id).first()) return bad('Request already exists');
  await db.prepare("INSERT INTO friends (user_id,friend_id,status) VALUES (?,?,'pending')").bind(u.id, o.id).run();
  return c.json({ ok: true });
});
app.post('/api/friends/accept', async (c) => {
  const u = c.get('user'), db = c.env.DB;
  const { user_id } = await c.req.json().catch(() => ({}));
  const r = await db.prepare("UPDATE friends SET status='accepted' WHERE user_id=? AND friend_id=? AND status='pending'").bind(user_id, u.id).run();
  if (!r.meta.changes) return bad('No pending request', 404);
  await db.prepare("INSERT OR REPLACE INTO friends (user_id,friend_id,status) VALUES (?,?,'accepted')").bind(u.id, user_id).run();
  await Promise.all([bumpStat(db, u.id, 'friends'), bumpStat(db, user_id, 'friends')]);
  return c.json({ ok: true });
});
app.delete('/api/friends/:id', async (c) => {
  const u = c.get('user'), id = Number(c.req.param('id'));
  await c.env.DB.prepare('DELETE FROM friends WHERE (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?)').bind(u.id, id, id, u.id).run();
  return c.json({ ok: true });
});

// ---------- realtime ----------
app.get('/ws/garden/:id', async (c) => {
  if (c.req.header('upgrade') !== 'websocket') return bad('Expected websocket', 426);
  const u = await loadUser(c.env.DB, getCookie(c, 'sid'));
  if (!u) return bad('Not signed in', 401);
  const ownerId = Number(c.req.param('id'));
  if (ownerId !== u.id && !(await c.env.DB.prepare("SELECT 1 FROM friends WHERE user_id=? AND friend_id=? AND status='accepted'").bind(u.id, ownerId).first())) return bad('Not friends', 403);
  const stub = c.env.GARDEN.get(c.env.GARDEN.idFromName(String(ownerId)));
  const headers = new Headers(c.req.raw.headers);
  headers.set('x-user', JSON.stringify({ id: u.id, name: u.username, character: u.character ?? 0, ownerId }));
  return stub.fetch(new Request(c.req.raw.url, { headers }));
});

app.notFound((c) => (c.req.path.startsWith('/api/') ? bad('Not found', 404) : c.env.ASSETS.fetch(c.req.raw)));
export default app;
