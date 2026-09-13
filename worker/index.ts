import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import {
  START, DAILY_CAP, PLANTS, CARDS, FURNITURE, GEM_PRICE_COINS, REEL_WEIGHTS, STAGES, MAX_LEVEL,
  WITHER_MAX, FREEZES_PER_MONTH, GROWTH_OPTIONS, growMs, plantReward, taskReward, levelFromXp, xpForLevel, gardenTiles, plotsUnlocked, caseSlots, spinPayout, dayKey, addDays, daysBetween, weightedPick,
  SEASON_CHANGE_GEMS, SEASONS, FENCE_COLORS, defaultFences, defaultTrees, STARTER_FURNITURE, furnitureById, furnitureFits, shopRotation,
  type Reel, type Season, type FenceColor, type PlacedFurniture,
} from '../src/shared/rules';

export { GardenRoom } from './garden-room';

export type Env = { DB: D1Database; GARDEN: DurableObjectNamespace; ASSETS: Fetcher };
interface UserRow {
  id: number; username: string; pass_hash: string; salt: string; friend_code: string; character: number | null;
  coins: number; gems: number; xp: number; streak: number; last_task_day: string | null; last_roll_day: string | null;
  wither: number; frozen: number; music: number; sfx: number; pomo_work: number; pomo_break: number; pomo_reps: number;
  location: string | null; last_seen: number; created_at: number;
  freezes_used: number; freeze_month: string; growth: number; tutorial_done: number; music_track: number; music_volume: number; is_admin: number; season: Season;
  fence_color: FenceColor; garden_init: number;
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
const userLevel = (u: Pick<UserRow, 'xp'>) => levelFromXp(u.xp).level;

async function bumpStat(db: D1Database, userId: number, key: string, by = 1) {
  await db.prepare('INSERT INTO stats (user_id,key,value) VALUES (?,?,?) ON CONFLICT(user_id,key) DO UPDATE SET value=value+excluded.value').bind(userId, key, by).run();
}
async function getDaily(db: D1Database, userId: number, day: string) {
  await db.prepare('INSERT OR IGNORE INTO daily (user_id,day) VALUES (?,?)').bind(userId, day).run();
  return (await db.prepare('SELECT * FROM daily WHERE user_id=? AND day=?').bind(userId, day).first())! as { day: string; xp: number; coins: number; tasks_done: number; spun: number };
}
/** Plants whose timer has elapsed become mature and pay their one-time harvest reward (XP + coins, scaled by growth pace). */
async function settlePlots(db: D1Database, userId: number, growth: number, now: number) {
  const done = (await db.prepare('SELECT id, plant_id FROM plots WHERE user_id=? AND plant_id IS NOT NULL AND stage<? AND ready_at IS NOT NULL AND ready_at<=?').bind(userId, STAGES, now).all<{ id: number; plant_id: number }>()).results;
  if (!done.length) return;
  let xp = 0, coins = 0;
  for (const p of done) { const plant = PLANTS.find((x) => x.id === p.plant_id); if (plant) { const r = plantReward(plant, growth); xp += r.xp; coins += r.coins; } }
  await db.batch([
    db.prepare(`UPDATE plots SET stage=?, ready_at=NULL WHERE id IN (${done.map(() => '?').join(',')})`).bind(STAGES, ...done.map((p) => p.id)),
    db.prepare('UPDATE users SET xp=xp+?, coins=coins+? WHERE id=?').bind(xp, coins, userId),
  ]);
  await Promise.all([bumpStat(db, userId, 'plants_grown', done.length), bumpStat(db, userId, 'xp_earned', xp), bumpStat(db, userId, 'coins_earned', coins)]);
}
/** First visit after signup (or after the v3 migration): starter fence ring, two grown trees, bed + desk + bookcase. */
async function ensureInit(db: D1Database, u: UserRow) {
  if (u.garden_init) return;
  const n = gardenTiles(userLevel(u)), now = Date.now();
  const stmts: D1PreparedStatement[] = [];
  if (!(await db.prepare('SELECT 1 FROM fences WHERE user_id=?').bind(u.id).first())) {
    for (const f of defaultFences(n)) stmts.push(db.prepare('INSERT OR IGNORE INTO fences (user_id,tx,ty,kind) VALUES (?,?,?,?)').bind(u.id, f.tx, f.ty, f.kind));
    for (const t of defaultTrees(n)) stmts.push(db.prepare('INSERT OR IGNORE INTO plots (user_id,tx,ty,plant_id,stage,planted_at,ready_at) VALUES (?,?,?,?,?,?,NULL)').bind(u.id, t.tx, t.ty, t.plant_id, STAGES, now));
  }
  if (!(await db.prepare('SELECT 1 FROM furniture_placed WHERE user_id=?').bind(u.id).first())) {
    for (const s of STARTER_FURNITURE) {
      stmts.push(db.prepare('INSERT INTO furniture_owned (user_id,furniture_id,qty) VALUES (?,?,1) ON CONFLICT(user_id,furniture_id) DO UPDATE SET qty=qty+1').bind(u.id, s.id));
      stmts.push(db.prepare('INSERT INTO furniture_placed (user_id,furniture_id,cx,cy,locked) VALUES (?,?,?,?,1)').bind(u.id, s.id, s.cx, s.cy));
    }
  }
  stmts.push(db.prepare('UPDATE users SET garden_init=1 WHERE id=?').bind(u.id));
  await db.batch(stmts);
  u.garden_init = 1;
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
  return u.is_admin ? { ...rest, coins: 999999, gems: 999999 } : rest;
}
async function meResponse(db: D1Database, u: UserRow, today: string) {
  await ensureInit(db, u);
  await settlePlots(db, u.id, u.growth, Date.now());
  const fresh = await db.prepare('SELECT xp, coins FROM users WHERE id=?').bind(u.id).first<{ xp: number; coins: number }>();
  if (fresh) { u.xp = fresh.xp; u.coins = fresh.coins; }
  const [plots, fences, inventory, cards, furniture, placed, folders, seasons, stats, tasks] = await Promise.all([
    db.prepare('SELECT id,tx,ty,plant_id,stage,planted_at,ready_at FROM plots WHERE user_id=? ORDER BY id').bind(u.id).all(),
    db.prepare('SELECT tx,ty,kind FROM fences WHERE user_id=?').bind(u.id).all(),
    db.prepare('SELECT plant_id,qty FROM inventory WHERE user_id=?').bind(u.id).all(),
    db.prepare('SELECT card_id,slot FROM cards WHERE user_id=?').bind(u.id).all(),
    db.prepare('SELECT furniture_id,qty FROM furniture_owned WHERE user_id=? AND qty>0').bind(u.id).all(),
    db.prepare('SELECT id,furniture_id,cx,cy,locked FROM furniture_placed WHERE user_id=?').bind(u.id).all(),
    db.prepare('SELECT name FROM task_folders WHERE user_id=? ORDER BY name').bind(u.id).all<{ name: string }>(),
    db.prepare('SELECT season FROM owned_seasons WHERE user_id=? ORDER BY season').bind(u.id).all<{ season: Season }>(),
    db.prepare('SELECT key,value FROM stats WHERE user_id=?').bind(u.id).all<{ key: string; value: number }>(),
    db.prepare('SELECT * FROM tasks WHERE user_id=? AND completed_at IS NULL ORDER BY COALESCE(due_date,\'9999-12-31\'), priority DESC, created_at DESC').bind(u.id).all(),
  ]);
  const daily = await getDaily(db, u.id, today);
  const freezesLeft = u.freeze_month === today.slice(0, 7) ? Math.max(0, FREEZES_PER_MONTH - u.freezes_used) : FREEZES_PER_MONTH;
  return { user: publicUser(u), freezesLeft, plots: plots.results, fences: fences.results, inventory: inventory.results, cards: cards.results, furniture: furniture.results, placed: placed.results, folders: folders.results.map((f) => f.name), seasons: seasons.results.map((s) => s.season), daily, tasks: tasks.results, stats: Object.fromEntries(stats.results.map((r) => [r.key, r.value])) };
}
/** Push a message to every open session of a user (friend request / accept toasts). */
function notify(env: Env, userId: number, msg: unknown) {
  const stub = env.GARDEN.get(env.GARDEN.idFromName(String(userId)));
  return stub.fetch('https://garden/notify', { method: 'POST', body: JSON.stringify(msg) }).catch(() => {});
}

// ---------- auth ----------
app.post('/api/auth/signup', async (c) => {
  const { username, password, level } = await c.req.json().catch(() => ({}));
  if (!isName(username)) return bad('Username: 3-20 letters, numbers or _');
  if (typeof password !== 'string' || password.length < 6 || password.length > 128) return bad('Password must be at least 6 characters');
  if (await c.env.DB.prepare('SELECT 1 FROM users WHERE username=?').bind(username).first()) return bad('Username taken', 409);
  const salt = randomHex(16);
  const pass_hash = await hashPassword(password, salt);
  let code = friendCode();
  while (await c.env.DB.prepare('SELECT 1 FROM users WHERE friend_code=?').bind(code).first()) code = friendCode();
  const isAdmin = password === 'ADMIN_TEST' ? 1 : 0;
  const xp = isAdmin && Number.isFinite(Number(level)) ? xpForLevel(Math.max(0, Math.min(MAX_LEVEL, Math.round(Number(level))))) : 0;
  const r = await c.env.DB.prepare('INSERT INTO users (username,pass_hash,salt,friend_code,coins,gems,xp,is_admin,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(username, pass_hash, salt, code, START.coins, START.gems, xp, isAdmin, Date.now()).run();
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
  if (!Number.isInteger(character) || character < 0 || character > 19) return bad('Bad character');
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
/** Admin test accounts pick their level freely; the garden size follows from it like for everyone else. */
app.post('/api/me/admin-level', async (c) => {
  const u = c.get('user');
  if (!u.is_admin) return bad('Admin accounts only', 403);
  const level = Math.round(Number((await c.req.json().catch(() => ({}))).level));
  if (!Number.isFinite(level) || level < 0 || level > MAX_LEVEL) return bad(`Level must be 0-${MAX_LEVEL}`);
  await c.env.DB.prepare('UPDATE users SET xp=? WHERE id=?').bind(xpForLevel(level), u.id).run();
  return c.json({ level, xp: xpForLevel(level) });
});
app.post('/api/me/fence-color', async (c) => {
  const u = c.get('user');
  const color = String((await c.req.json().catch(() => ({}))).color ?? '');
  if (!(FENCE_COLORS as readonly string[]).includes(color)) return bad('No such colour');
  await c.env.DB.prepare('UPDATE users SET fence_color=? WHERE id=?').bind(color, u.id).run();
  return c.json({ color });
});
app.post('/api/me/season', async (c) => {
  const u = c.get('user');
  const season = String((await c.req.json().catch(() => ({}))).season ?? '') as Season;
  if (!SEASONS.some((s) => s.value === season)) return bad('Choose a valid season');
  if (season === u.season) return c.json({ season, cost: 0 });
  if (season !== 'auto' && !(await c.env.DB.prepare('SELECT 1 FROM owned_seasons WHERE user_id=? AND season=?').bind(u.id, season).first())) return bad('Buy this season in the shop first');
  await c.env.DB.prepare('UPDATE users SET season=? WHERE id=?').bind(season, u.id).run();
  return c.json({ season });
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
  const dueDate = typeof b.due_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.due_date) ? b.due_date : null;
  const priority = Number(b.priority ?? 2);
  const difficulty = Number(b.difficulty), est = Number(b.est_minutes);
  if (!name) return bad('Task needs a name');
  if (![1, 2, 3].includes(difficulty)) return bad('Difficulty must be 1-3');
  if (![1, 2, 3].includes(priority)) return bad('Priority must be 1-3');
  if (!Number.isInteger(est) || est < 5 || est > 300) return bad('Estimate must be 5-300 minutes');
  const now = Date.now();
  const r = await c.env.DB.prepare('INSERT INTO tasks (user_id,name,description,folder,due_date,priority,difficulty,est_minutes,created_at,started_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .bind(u.id, name, description, folder, dueDate, priority, difficulty, est, now, b.start ? now : null).run();
  await bumpStat(c.env.DB, u.id, 'tasks_created');
  if (folder) await c.env.DB.prepare('INSERT OR IGNORE INTO task_folders (user_id,name) VALUES (?,?)').bind(u.id, folder).run();
  return c.json(await c.env.DB.prepare('SELECT * FROM tasks WHERE id=?').bind(r.meta.last_row_id).first());
});
app.post('/api/tasks/:id/folder', async (c) => {
  const u = c.get('user');
  const folder = String((await c.req.json().catch(() => ({}))).folder ?? '').trim().slice(0, 30);
  await c.env.DB.prepare('UPDATE tasks SET folder=? WHERE id=? AND user_id=?').bind(folder, c.req.param('id'), u.id).run();
  if (folder) await c.env.DB.prepare('INSERT OR IGNORE INTO task_folders (user_id,name) VALUES (?,?)').bind(u.id, folder).run();
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
  if (t.started_at && !t.pomodoro) return bad('Finish the focus session before you complete this task');
  const b = await c.req.json().catch(() => ({}));
  let actual: number | null = Number.isFinite(b.actual_minutes) && b.actual_minutes > 0 ? Math.round(b.actual_minutes) : null;
  if (actual === null && t.started_at) actual = Math.max(1, Math.round((now - t.started_at) / 60_000));
  const full = taskReward(t.difficulty, t.est_minutes, actual, !!t.pomodoro);
  const daily = await getDaily(db, u.id, today);
  const xp = u.is_admin ? full.xp : Math.max(0, Math.min(full.xp, DAILY_CAP.xp - daily.xp));
  const coins = u.is_admin ? full.coins : Math.max(0, Math.min(full.coins, DAILY_CAP.coins - daily.coins));
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
  const owner = await c.env.DB.prepare('SELECT * FROM users WHERE id=?').bind(id).first<UserRow>();
  if (!owner) return bad('No such garden', 404);
  if (id !== me.id && !(await c.env.DB.prepare("SELECT 1 FROM friends WHERE user_id=? AND friend_id=? AND status='accepted'").bind(me.id, id).first())) return bad('Not friends', 403);
  await ensureInit(c.env.DB, owner);
  await settlePlots(c.env.DB, id, owner.growth, Date.now());
  const [plots, fences] = await Promise.all([
    c.env.DB.prepare('SELECT id,tx,ty,plant_id,stage,planted_at,ready_at FROM plots WHERE user_id=? ORDER BY id').bind(id).all(),
    c.env.DB.prepare('SELECT tx,ty,kind FROM fences WHERE user_id=?').bind(id).all(),
  ]);
  return c.json({ owner: { id: owner.id, username: owner.username, character: owner.character, level: userLevel(owner), wither: owner.wither, frozen: owner.frozen, season: owner.season, fence_color: owner.fence_color, growth: owner.growth }, plots: plots.results, fences: fences.results });
});
const inGarden = (u: UserRow, tx: unknown, ty: unknown) => { const n = gardenTiles(userLevel(u)); return Number.isInteger(tx) && Number.isInteger(ty) && (tx as number) >= 0 && (ty as number) >= 0 && (tx as number) < n && (ty as number) < n; };
async function tileFree(db: D1Database, userId: number, tx: number, ty: number) {
  const p = await db.prepare('SELECT 1 FROM plots WHERE user_id=? AND tx=? AND ty=?').bind(userId, tx, ty).first();
  const f = await db.prepare('SELECT 1 FROM fences WHERE user_id=? AND tx=? AND ty=?').bind(userId, tx, ty).first();
  return !p && !f;
}
/** Hoe a tile into a plot. Free; the number of plots is limited by level. */
app.post('/api/plots/hoe', async (c) => {
  const u = c.get('user'), db = c.env.DB;
  const { tx, ty } = await c.req.json().catch(() => ({}));
  if (!inGarden(u, tx, ty)) return bad('Outside your garden');
  const owned = (await db.prepare('SELECT COUNT(*) AS n FROM plots WHERE user_id=?').bind(u.id).first<{ n: number }>())!.n;
  if (!u.is_admin && owned >= plotsUnlocked(userLevel(u))) return bad('Level up to unlock more plots');
  if (!(await tileFree(db, u.id, tx, ty))) return bad('That tile is taken');
  await db.prepare('INSERT INTO plots (user_id,tx,ty) VALUES (?,?,?)').bind(u.id, tx, ty).run();
  await bumpStat(db, u.id, 'plots_bought');
  return c.json({ ok: true });
});
app.post('/api/plots/:id/plant', async (c) => {
  const u = c.get('user'), db = c.env.DB, now = Date.now();
  const { plant_id } = await c.req.json().catch(() => ({}));
  const plant = PLANTS.find((p) => p.id === plant_id);
  if (!plant) return bad('No such plant');
  const plot = await db.prepare('SELECT * FROM plots WHERE id=? AND user_id=?').bind(c.req.param('id'), u.id).first<any>();
  if (!plot) return bad('No such plot', 404);
  if (plot.plant_id) return bad('Plot already planted');
  const inv = await db.prepare('SELECT qty FROM inventory WHERE user_id=? AND plant_id=?').bind(u.id, plant_id).first<{ qty: number }>();
  if (!u.is_admin && (!inv || inv.qty < 1)) return bad('No seeds of that plant');
  const ready = u.is_admin ? null : now + growMs(plant, u.growth);
  const changes = [db.prepare('UPDATE plots SET plant_id=?, stage=?, planted_at=?, ready_at=? WHERE id=?').bind(plant_id, u.is_admin ? STAGES : 0, now, ready, plot.id)];
  if (!u.is_admin) changes.unshift(db.prepare('UPDATE inventory SET qty=qty-1 WHERE user_id=? AND plant_id=?').bind(u.id, plant_id));
  await db.batch(changes);
  await bumpStat(db, u.id, 'plants_planted');
  return c.json({ ok: true, ready_at: ready });
});
/** Move a plot (with whatever is growing in it, timer intact) to a free tile. */
app.post('/api/plots/:id/move', async (c) => {
  const u = c.get('user'), db = c.env.DB;
  const { tx, ty } = await c.req.json().catch(() => ({}));
  if (!inGarden(u, tx, ty)) return bad('Outside your garden');
  const plot = await db.prepare('SELECT id FROM plots WHERE id=? AND user_id=?').bind(c.req.param('id'), u.id).first();
  if (!plot) return bad('No such plot', 404);
  if (!(await tileFree(db, u.id, tx, ty))) return bad('That tile is taken');
  await db.prepare('UPDATE plots SET tx=?, ty=? WHERE id=?').bind(tx, ty, c.req.param('id')).run();
  return c.json({ ok: true });
});
/** Grassify: the plot and anything planted in it are gone. */
app.post('/api/plots/:id/remove', async (c) => {
  await c.env.DB.prepare('DELETE FROM plots WHERE id=? AND user_id=?').bind(c.req.param('id'), c.get('user').id).run();
  return c.json({ ok: true });
});
/** Place, replace or remove (kind null) a fence / gate piece. */
app.post('/api/garden/fence', async (c) => {
  const u = c.get('user'), db = c.env.DB;
  const { tx, ty, kind } = await c.req.json().catch(() => ({}));
  if (!inGarden(u, tx, ty)) return bad('Outside your garden');
  if (kind !== null && kind !== 'fence' && kind !== 'gate') return bad('Bad piece');
  if (kind === null) { await db.prepare('DELETE FROM fences WHERE user_id=? AND tx=? AND ty=?').bind(u.id, tx, ty).run(); return c.json({ ok: true }); }
  if (await db.prepare('SELECT 1 FROM plots WHERE user_id=? AND tx=? AND ty=?').bind(u.id, tx, ty).first()) return bad('There is a plot here');
  await db.prepare('INSERT INTO fences (user_id,tx,ty,kind) VALUES (?,?,?,?) ON CONFLICT(user_id,tx,ty) DO UPDATE SET kind=excluded.kind').bind(u.id, tx, ty, kind).run();
  return c.json({ ok: true });
});

// ---------- shop ----------
app.get('/api/shop', async (c) => {
  const u = c.get('user'), day = c.get('today');
  const rot = shopRotation(u.id, day);
  const collected = (await c.env.DB.prepare('SELECT plant_id FROM inventory WHERE user_id=?').bind(u.id).all<{ plant_id: number }>()).results.map((r) => r.plant_id);
  const ownedCards = (await c.env.DB.prepare('SELECT card_id FROM cards WHERE user_id=?').bind(u.id).all<{ card_id: number }>()).results.map((r) => r.card_id);
  return c.json({ ...rot, ownedCards, collected, day, daily: await getDaily(c.env.DB, u.id, day) });
});
async function addSeed(db: D1Database, userId: number, plantId: number, qty = 1) {
  await db.prepare('INSERT INTO inventory (user_id,plant_id,qty) VALUES (?,?,?) ON CONFLICT(user_id,plant_id) DO UPDATE SET qty=qty+excluded.qty').bind(userId, plantId, qty).run();
}
app.post('/api/shop/seed', async (c) => {
  const u = c.get('user'), db = c.env.DB;
  const { plant_id } = await c.req.json().catch(() => ({}));
  const p = PLANTS.find((x) => x.id === plant_id);
  if (!p) return bad('No such plant');
  if (!u.is_admin && !shopRotation(u.id, c.get('today')).plants.includes(p.id)) return bad('Not in the shop today');
  if (!u.is_admin && u.coins < p.price) return bad(`Need ${p.price} coins`);
  if (!u.is_admin) await db.prepare('UPDATE users SET coins=coins-? WHERE id=?').bind(p.price, u.id).run();
  await addSeed(db, u.id, p.id);
  await bumpStat(db, u.id, 'seeds_bought');
  return c.json({ ok: true, plant_id: p.id });
});
app.post('/api/shop/gems', async (c) => {
  const u = c.get('user');
  const qty = Math.max(1, Math.min(50, Math.round(Number((await c.req.json().catch(() => ({}))).qty) || 1)));
  const cost = qty * GEM_PRICE_COINS;
  if (!u.is_admin && u.coins < cost) return bad(`Need ${cost} coins`);
  if (!u.is_admin) await c.env.DB.prepare('UPDATE users SET coins=coins-?, gems=gems+? WHERE id=?').bind(cost, qty, u.id).run();
  return c.json({ ok: true, qty, cost });
});
app.post('/api/shop/card', async (c) => {
  const u = c.get('user'), db = c.env.DB;
  const { card_id } = await c.req.json().catch(() => ({}));
  const k = CARDS.find((x) => x.id === card_id);
  if (!k) return bad('No such card');
  if (!u.is_admin && shopRotation(u.id, c.get('today')).card !== k.id) return bad('That card is not in the shop today');
  if (await db.prepare('SELECT 1 FROM cards WHERE user_id=? AND card_id=?').bind(u.id, k.id).first()) return bad('Already owned');
  if (!u.is_admin && u.gems < k.price) return bad(`Need ${k.price} gems`);
  await db.batch([
    db.prepare('UPDATE users SET gems=gems-? WHERE id=?').bind(u.is_admin ? 0 : k.price, u.id),
    db.prepare('INSERT INTO cards (user_id,card_id) VALUES (?,?)').bind(u.id, k.id),
  ]);
  await bumpStat(db, u.id, 'cards_collected');
  return c.json({ ok: true });
});
app.post('/api/shop/spin', async (c) => {
  const u = c.get('user'), db = c.env.DB, today = c.get('today');
  const daily = await getDaily(db, u.id, today);
  if (!u.is_admin && daily.spun) return bad('Already spun today');
  const reels: Reel[] = [weightedPick(REEL_WEIGHTS), weightedPick(REEL_WEIGHTS), weightedPick(REEL_WEIGHTS)];
  const pay = spinPayout(reels, u.streak);
  await db.batch([
    db.prepare('UPDATE daily SET spun=? WHERE user_id=? AND day=?').bind(u.is_admin ? 0 : 1, u.id, today),
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
  if (slot !== null && (!Number.isInteger(slot) || slot < 0 || slot >= caseSlots(userLevel(u)))) return bad('No such slot');
  await db.batch([
    db.prepare('UPDATE cards SET slot=NULL WHERE user_id=? AND slot=?').bind(u.id, slot ?? -1),
    db.prepare('UPDATE cards SET slot=? WHERE user_id=? AND card_id=?').bind(slot, u.id, id),
  ]);
  return c.json({ ok: true });
});
app.post('/api/shop/furniture', async (c) => {
  const u = c.get('user'), db = c.env.DB;
  const id = Number((await c.req.json().catch(() => ({}))).furniture_id);
  const item = furnitureById(id);
  if (!item) return bad('No such furniture');
  if (!u.is_admin && !shopRotation(u.id, c.get('today')).furniture.includes(id)) return bad('Not in the shop today');
  if (!u.is_admin && u.coins < item.price) return bad(`Need ${item.price} coins`);
  await db.batch([
    db.prepare('UPDATE users SET coins=coins-? WHERE id=?').bind(u.is_admin ? 0 : item.price, u.id),
    db.prepare('INSERT INTO furniture_owned (user_id,furniture_id,qty) VALUES (?,?,1) ON CONFLICT(user_id,furniture_id) DO UPDATE SET qty=qty+1').bind(u.id, id),
  ]);
  await bumpStat(db, u.id, 'furniture_bought');
  return c.json({ ok: true });
});
app.post('/api/shop/season', async (c) => {
  const u = c.get('user'), db = c.env.DB;
  const season = String((await c.req.json().catch(() => ({}))).season ?? '') as Season;
  if (season === 'auto' || !SEASONS.some((s) => s.value === season)) return bad('No such season');
  if (await db.prepare('SELECT 1 FROM owned_seasons WHERE user_id=? AND season=?').bind(u.id, season).first()) return bad('Already owned');
  if (!u.is_admin && u.gems < SEASON_CHANGE_GEMS) return bad(`Need ${SEASON_CHANGE_GEMS} gem`);
  await db.batch([
    db.prepare('UPDATE users SET gems=gems-? WHERE id=?').bind(u.is_admin ? 0 : SEASON_CHANGE_GEMS, u.id),
    db.prepare('INSERT INTO owned_seasons (user_id,season) VALUES (?,?)').bind(u.id, season),
  ]);
  return c.json({ ok: true });
});

// ---------- furniture helpers + visiting a friend's room ----------
const placedRows = (db: D1Database, userId: number) => db.prepare('SELECT id,furniture_id,cx,cy,locked FROM furniture_placed WHERE user_id=?').bind(userId).all<PlacedFurniture>().then((r) => r.results);
app.get('/api/house/:id', async (c) => {
  const me = c.get('user'), id = Number(c.req.param('id'));
  const owner = await c.env.DB.prepare('SELECT * FROM users WHERE id=?').bind(id).first<UserRow>();
  if (!owner) return bad('No such home', 404);
  if (id !== me.id && !(await c.env.DB.prepare("SELECT 1 FROM friends WHERE user_id=? AND friend_id=? AND status='accepted'").bind(me.id, id).first())) return bad('Not friends', 403);
  await ensureInit(c.env.DB, owner);
  const placed = await placedRows(c.env.DB, id);
  return c.json({ owner: { id: owner.id, username: owner.username, character: owner.character }, placed });
});

// ---------- furniture in the room ----------
app.post('/api/furniture/place', async (c) => {
  const u = c.get('user'), db = c.env.DB;
  const { furniture_id, cx, cy } = await c.req.json().catch(() => ({}));
  const item = furnitureById(Number(furniture_id));
  if (!item || !Number.isInteger(cx) || !Number.isInteger(cy)) return bad('Bad placement');
  const placed = await placedRows(db, u.id);
  const owned = (await db.prepare('SELECT qty FROM furniture_owned WHERE user_id=? AND furniture_id=?').bind(u.id, item.id).first<{ qty: number }>())?.qty ?? 0;
  if (placed.filter((p) => p.furniture_id === item.id).length >= owned) return bad('None left in your inventory');
  if (!furnitureFits(placed, item, cx, cy)) return bad('It does not fit there (keep one tile free around furniture)');
  const r = await db.prepare('INSERT INTO furniture_placed (user_id,furniture_id,cx,cy) VALUES (?,?,?,?)').bind(u.id, item.id, cx, cy).run();
  return c.json({ ok: true, id: r.meta.last_row_id });
});
app.post('/api/furniture/:id/move', async (c) => {
  const u = c.get('user'), db = c.env.DB, id = Number(c.req.param('id'));
  const { cx, cy } = await c.req.json().catch(() => ({}));
  const placed = await placedRows(db, u.id);
  const row = placed.find((p) => p.id === id);
  if (!row) return bad('Not placed', 404);
  const item = furnitureById(row.furniture_id)!;
  if (!Number.isInteger(cx) || !Number.isInteger(cy) || !furnitureFits(placed, item, cx, cy, id)) return bad('It does not fit there (keep one tile free around furniture)');
  await db.prepare('UPDATE furniture_placed SET cx=?, cy=? WHERE id=?').bind(cx, cy, id).run();
  return c.json({ ok: true });
});
/** Back to the inventory; the piece is still owned. Starter pieces (bed, desk, bookcase) stay in the room. */
app.post('/api/furniture/:id/remove', async (c) => {
  const u = c.get('user'), db = c.env.DB, id = Number(c.req.param('id'));
  const row = await db.prepare('SELECT locked FROM furniture_placed WHERE id=? AND user_id=?').bind(id, u.id).first<{ locked: number }>();
  if (!row) return bad('Not placed', 404);
  if (row.locked) return bad('That piece stays in your home (you can move it)');
  await db.prepare('DELETE FROM furniture_placed WHERE id=?').bind(id).run();
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
  c.executionCtx.waitUntil(notify(c.env, o.id, { t: 'friend', kind: 'request', from: u.username, id: u.id }));
  return c.json({ ok: true });
});
app.post('/api/friends/accept', async (c) => {
  const u = c.get('user'), db = c.env.DB;
  const { user_id } = await c.req.json().catch(() => ({}));
  const r = await db.prepare("UPDATE friends SET status='accepted' WHERE user_id=? AND friend_id=? AND status='pending'").bind(user_id, u.id).run();
  if (!r.meta.changes) return bad('No pending request', 404);
  await db.prepare("INSERT OR REPLACE INTO friends (user_id,friend_id,status) VALUES (?,?,'accepted')").bind(u.id, user_id).run();
  await Promise.all([bumpStat(db, u.id, 'friends'), bumpStat(db, user_id, 'friends')]);
  c.executionCtx.waitUntil(notify(c.env, Number(user_id), { t: 'friend', kind: 'accepted', from: u.username, id: u.id }));
  return c.json({ ok: true });
});
app.delete('/api/friends/:id', async (c) => {
  const u = c.get('user'), id = Number(c.req.param('id'));
  await c.env.DB.prepare('DELETE FROM friends WHERE (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?)').bind(u.id, id, id, u.id).run();
  c.executionCtx.waitUntil(notify(c.env, id, { t: 'friend', kind: 'removed', from: u.username, id: u.id }));
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
/** Per-session notification socket (friend events). Lives in the user's own GardenRoom, never counts as being in the garden. */
app.get('/ws/hub', async (c) => {
  if (c.req.header('upgrade') !== 'websocket') return bad('Expected websocket', 426);
  const u = await loadUser(c.env.DB, getCookie(c, 'sid'));
  if (!u) return bad('Not signed in', 401);
  const stub = c.env.GARDEN.get(c.env.GARDEN.idFromName(String(u.id)));
  const headers = new Headers(c.req.raw.headers);
  headers.set('x-user', JSON.stringify({ id: u.id, name: u.username, character: u.character ?? 0, ownerId: u.id, hub: true }));
  return stub.fetch(new Request(c.req.raw.url, { headers }));
});

app.notFound((c) => (c.req.path.startsWith('/api/') ? bad('Not found', 404) : c.env.ASSETS.fetch(c.req.raw)));
export default app;
