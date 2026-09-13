/** Game rules shared by client and Worker. Pure functions + catalogs. No I/O. */

export const PALETTE = { sky: '#93AEBF', forest: '#103523', sage: '#BCCB9B', cream: '#F0EBCC', rose: '#CD9186', bark: '#745852' };

// ---------- currency + progression ----------
export const START = { coins: 100, gems: 10, plots: 6, seeds: { 1: 1, 2: 1 } as Record<number, number> };
export const DAILY_CAP = { xp: 600, coins: 300 };
export const MAX_LEVEL = 100;
export const BASE_XP: Record<number, number> = { 1: 10, 2: 20, 3: 35 };
export const GEM_PRICE_COINS = 25;
export const SEASON_CHANGE_GEMS = 1;

export type Season = 'auto' | 'summer' | 'rainy' | 'fall' | 'winter';
export type GardenSeason = Exclude<Season, 'auto'>;
export const SEASONS: { value: Season; label: string; note: string }[] = [
  { value: 'auto', label: 'Auto', note: 'Matches the US season' },
  { value: 'summer', label: 'Summer', note: 'Sun and green grass' },
  { value: 'rainy', label: 'Rainy', note: 'Rain over the garden' },
  { value: 'fall', label: 'Fall', note: 'Falling red leaves' },
  { value: 'winter', label: 'Winter', note: 'Drifting snow' },
];
/** Auto uses US meteorological seasons. Spring uses the rainy garden theme. */
export function effectiveSeason(setting: Season, month: number): GardenSeason {
  if (setting !== 'auto') return setting;
  if (month === 11 || month <= 1) return 'winter';
  if (month <= 4) return 'rainy';
  if (month <= 7) return 'summer';
  return 'fall';
}

/** Levels run 0..100 on a linear curve: 100 XP for level 1, +25 per level (~136k XP total). */
export function xpToNext(level: number): number { return 100 + 25 * level; }
export function xpForLevel(level: number): number { const l = Math.max(0, Math.min(MAX_LEVEL, Math.floor(level))); return 100 * l + (25 * l * (l - 1)) / 2; }
export function levelFromXp(xp: number): { level: number; into: number; next: number } {
  let level = 0, rem = Math.max(0, xp);
  while (level < MAX_LEVEL && rem >= xpToNext(level)) { rem -= xpToNext(level); level++; }
  return { level, into: rem, next: level >= MAX_LEVEL ? 0 : xpToNext(level) };
}

/** Time factor: longer estimates pay more. 30m=1.5, 1h=2, 3h=4, 5h=6 */
export function timeFactor(estMinutes: number): number { return 1 + estMinutes / 60; }
/** Multiplier from actual/estimated ratio. Slight penalty for rushing (guards gaming), linear decay for overtime, floor 0.5 at 2x. */
export function timingMult(actualMinutes: number | null | undefined, estMinutes: number): number {
  if (!actualMinutes || actualMinutes <= 0) return 1;
  const r = actualMinutes / estMinutes;
  if (r < 0.8) return 0.9;
  if (r <= 1.2) return 1;
  return Math.max(0.5, 1 - (r - 1.2) / 1.6);
}
export function taskReward(difficulty: number, estMinutes: number, actualMinutes: number | null | undefined, pomodoro: boolean): { xp: number; coins: number } {
  const base = BASE_XP[difficulty] * timeFactor(estMinutes) * timingMult(actualMinutes, estMinutes);
  const xp = Math.round(base) * (pomodoro ? 2 : 1);
  return { xp, coins: Math.round(base / 2) };
}
/** Preview shown on the create-task form (no timing, no pomodoro). */
export function previewReward(difficulty: number, estMinutes: number) { return taskReward(difficulty, estMinutes, null, false); }

// ---------- garden ----------
export const TILE = 64;
/** 12x12 at level 0, one tile wider every 5 levels, 32x32 at level 100. */
export function gardenTiles(level: number): number { return Math.min(32, 12 + Math.floor(Math.max(0, level) / 5)); }
export function plotsUnlocked(level: number): number { return START.plots + Math.max(0, level); }
export const STAGES = 3; // stage 0 seed (bare soil), 1 twig, 2 young, 3 mature
export const SPROUT_MS = 10_000;
export const WITHER_MAX = 4;
export const FREEZES_PER_MONTH = 2;
/** Growth pace (settings): minutes for a flower to mature and the harvest reward multiplier. */
export const GROWTH_OPTIONS = [
  { value: 50, label: 'Quick', minutes: 10, mult: 1, desc: '10 min flowers · normal reward' },
  { value: 100, label: 'Normal', minutes: 20, mult: 1.5, desc: '20 min flowers · 1.5× reward' },
  { value: 200, label: 'Patient', minutes: 30, mult: 2, desc: '30 min flowers · 2× reward' },
] as const;
const growthOpt = (growth: number) => GROWTH_OPTIONS.find((g) => g.value === growth) ?? GROWTH_OPTIONS[1];
export function growMs(plant: Plant, growth: number): number { return growthOpt(growth).minutes * 60_000 * (plant.kind === 'tree' ? 2 : 1); }
const RARITY_XP: Record<Rarity, number> = { common: 15, uncommon: 30, rare: 60, epic: 100 };
/** XP + coins granted once when a plant matures. */
export function plantReward(plant: Plant, growth: number): { xp: number; coins: number } {
  const m = growthOpt(growth).mult;
  return { xp: Math.round(RARITY_XP[plant.rarity] * m), coins: Math.round((RARITY_XP[plant.rarity] / 2) * m) };
}
/** Visual stage of a plot right now. -1 = nothing planted. */
export function plantStage(p: Pick<Plot, 'plant_id' | 'stage' | 'planted_at' | 'ready_at'>, now: number): number {
  if (!p.plant_id) return -1;
  if (p.stage >= STAGES || !p.ready_at || !p.planted_at || now >= p.ready_at) return STAGES;
  const t = now - p.planted_at;
  if (t < SPROUT_MS) return 0;
  return t < (p.ready_at - p.planted_at) / 2 ? 1 : 2;
}

// fences: the piece is chosen from the four neighbours so runs, corners and junctions always connect
export type FencePiece = 'post' | 'h_l' | 'h_m' | 'h_r' | 'v_t' | 'v_m' | 'v_b' | 'tl' | 'tr' | 'bl' | 'br' | 't_up' | 't_down' | 't_left' | 't_right' | 'cross';
export function fencePiece(n: boolean, e: boolean, s: boolean, w: boolean): FencePiece {
  const k = (n ? 1 : 0) | (e ? 2 : 0) | (s ? 4 : 0) | (w ? 8 : 0);
  return (['post', 'v_b', 'h_l', 'bl', 'v_t', 'v_m', 'tl', 't_right', 'h_r', 'br', 'h_m', 't_up', 'tr', 't_left', 't_down', 'cross'] as FencePiece[])[k];
}
export const FENCE_COLORS = ['brown', 'dark_brown', 'light_brown', 'black', 'dark_grey', 'light_grey', 'white'] as const;
export type FenceColor = (typeof FENCE_COLORS)[number];
export interface FenceTile { tx: number; ty: number; kind: 'fence' | 'gate' }
/** Starter layout: a fenced ring one tile in from the edge with a gate at the top. */
export function defaultFences(n: number): FenceTile[] {
  const out: FenceTile[] = [];
  const gate = Math.floor(n / 2);
  for (let x = 1; x <= n - 2; x++) { out.push({ tx: x, ty: 1, kind: x === gate ? 'gate' : 'fence' }); out.push({ tx: x, ty: n - 2, kind: 'fence' }); }
  for (let y = 2; y <= n - 3; y++) { out.push({ tx: 1, ty: y, kind: 'fence' }); out.push({ tx: n - 2, ty: y, kind: 'fence' }); }
  return out;
}

// ---------- daily spin ----------
export type Reel = 'coin' | 'sprout' | 'gem';
export const REEL_WEIGHTS: Record<Reel, number> = { coin: 5, sprout: 3, gem: 2 };
export function spinBaseCoins(streak: number): number { return 50 + Math.min(200, 10 * streak); }
export function spinPayout(reels: Reel[], streak: number): { coins: number; gems: number } {
  const gems = reels.filter((r) => r === 'gem').length;
  const coins = reels.filter((r) => r === 'coin').length;
  const base = spinBaseCoins(streak);
  return { coins: coins === 3 ? base * 3 : base, gems: gems === 3 ? 5 : gems === 2 ? 2 : gems };
}

// ---------- catalogs ----------
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic';
export interface Plant { id: number; name: string; kind: 'flower' | 'tree'; rarity: Rarity; price: number }
const F = (id: number, name: string, rarity: Rarity, price: number): Plant => ({ id, name, kind: 'flower', rarity, price });
/** Plantable flowers. Retired tree IDs 21-32 must not be reused. */
export const PLANTS: Plant[] = [
  F(1, 'Red Rose', 'common', 70), F(2, 'Morning Glory', 'common', 60), F(3, 'Bluebell', 'common', 65), F(4, 'White Tulip', 'common', 60), F(5, 'Red Poppy', 'common', 70),
  F(6, 'Narcissus', 'common', 65), F(7, 'Pink Hibiscus', 'common', 80), F(8, 'Pink Peony', 'common', 85), F(9, 'Forget-me-not', 'common', 60), F(10, 'Marigold', 'common', 65),
  F(11, 'Blue Lupine', 'uncommon', 120), F(12, 'Pink Tulip', 'uncommon', 110), F(13, 'Orange Daisy', 'uncommon', 110), F(14, 'Cornflower', 'uncommon', 120), F(15, 'Goldenrod', 'uncommon', 115),
  F(16, 'Blue Iris', 'uncommon', 130), F(17, 'Hydrangea', 'uncommon', 140), F(18, 'Buttercup', 'uncommon', 110), F(19, 'Yellow Mimosa', 'uncommon', 135), F(20, 'Lily of the Valley', 'uncommon', 150),
];
export const plantById = (id: number) => PLANTS.find((p) => p.id === id);
export const plantSprite = (p: Plant) => `${p.kind}_${p.id}`;

export interface Card { id: number; name: string; rarity: Rarity; price: number }
/** Gem prices are deliberately steep: a card is the rarest thing in the shop. */
export const CARDS: Card[] = [
  { id: 0, name: 'Mountain Fox', rarity: 'rare', price: 120 },
  { id: 1, name: 'Forest Owl', rarity: 'rare', price: 120 },
  { id: 2, name: 'Golden Koi', rarity: 'epic', price: 200 },
  { id: 3, name: 'Sakura Stag', rarity: 'epic', price: 200 },
];
export function caseSlots(level: number): number { return Math.min(12, 6 + 2 * Math.floor(Math.max(0, level) / 5)); }

export type FurnitureKind = 'bed' | 'solid' | 'walk' | 'rug' | 'bookcase' | 'desk';
export interface Furniture { id: number; name: string; price: number; kind: FurnitureKind; w: number; h: number }
/** Sprite = furniture/f_<id>.png; w x h is the floor footprint in room tiles (tall items draw above their footprint). */
export const FURNITURE: Furniture[] = [
  { id: 1, name: 'Green Plaid Bed', price: 180, kind: 'bed', w: 2, h: 2 }, { id: 2, name: 'Pink Bed', price: 180, kind: 'bed', w: 2, h: 2 },
  { id: 3, name: 'Blue Bed', price: 180, kind: 'bed', w: 2, h: 2 }, { id: 4, name: 'Yellow Check Bed', price: 180, kind: 'bed', w: 2, h: 2 },
  { id: 5, name: 'Oak Nightstand', price: 45, kind: 'solid', w: 1, h: 1 }, { id: 6, name: 'Book Nightstand', price: 45, kind: 'solid', w: 1, h: 1 },
  { id: 7, name: 'Small Dresser', price: 90, kind: 'solid', w: 2, h: 1 }, { id: 8, name: 'Flower Dresser', price: 110, kind: 'solid', w: 2, h: 1 },
  { id: 9, name: 'Vanity Mirror', price: 120, kind: 'solid', w: 1, h: 1 }, { id: 10, name: 'Green Wardrobe', price: 130, kind: 'solid', w: 1, h: 1 },
  { id: 11, name: 'Oak Wardrobe', price: 130, kind: 'solid', w: 1, h: 1 }, { id: 12, name: 'Standing Mirror', price: 85, kind: 'solid', w: 2, h: 1 },
  { id: 13, name: 'Bookcase', price: 140, kind: 'bookcase', w: 2, h: 1 }, { id: 14, name: 'Plant Bookcase', price: 160, kind: 'bookcase', w: 2, h: 1 },
  { id: 15, name: 'Green Hutch', price: 170, kind: 'solid', w: 2, h: 1 }, { id: 16, name: 'Ladder Shelf', price: 70, kind: 'solid', w: 1, h: 1 },
  { id: 17, name: 'Fireplace', price: 260, kind: 'solid', w: 2, h: 1 }, { id: 18, name: 'Writing Desk', price: 150, kind: 'desk', w: 2, h: 1 },
  { id: 19, name: 'Side Table', price: 55, kind: 'solid', w: 1, h: 1 }, { id: 20, name: 'Dining Table', price: 140, kind: 'solid', w: 3, h: 1 },
  { id: 21, name: 'Round Table', price: 80, kind: 'solid', w: 2, h: 1 }, { id: 22, name: 'Coffee Table', price: 95, kind: 'solid', w: 2, h: 1 },
  { id: 23, name: 'Garden Bench', price: 90, kind: 'solid', w: 2, h: 1 }, { id: 24, name: 'Wooden Chair', price: 40, kind: 'walk', w: 1, h: 1 },
  { id: 25, name: 'Cushion Chair', price: 50, kind: 'walk', w: 1, h: 1 }, { id: 26, name: 'Green Chair', price: 50, kind: 'walk', w: 1, h: 1 },
  { id: 27, name: 'Stool', price: 30, kind: 'walk', w: 1, h: 1 }, { id: 28, name: 'Armchair', price: 120, kind: 'solid', w: 1, h: 1 },
  { id: 29, name: 'Cream Sofa', price: 200, kind: 'solid', w: 2, h: 1 }, { id: 30, name: 'Cat Beanbag', price: 95, kind: 'walk', w: 1, h: 1 },
  { id: 31, name: 'Floor Lamp', price: 75, kind: 'solid', w: 1, h: 1 }, { id: 32, name: 'Mushroom Lamp', price: 65, kind: 'solid', w: 1, h: 1 },
  { id: 33, name: 'Green Rug', price: 110, kind: 'rug', w: 3, h: 1 }, { id: 34, name: 'Plaid Rug', price: 110, kind: 'rug', w: 3, h: 1 },
  { id: 35, name: 'Pink Rug', price: 110, kind: 'rug', w: 2, h: 1 }, { id: 36, name: 'Round Rug', price: 80, kind: 'rug', w: 2, h: 1 },
  { id: 37, name: 'Bear Rug', price: 130, kind: 'rug', w: 2, h: 1 }, { id: 38, name: 'Monstera', price: 60, kind: 'solid', w: 2, h: 1 },
  { id: 39, name: 'Snake Plant', price: 45, kind: 'solid', w: 1, h: 1 }, { id: 40, name: 'Flower Planter', price: 70, kind: 'solid', w: 1, h: 1 },
];
export const furnitureById = (id: number) => FURNITURE.find((f) => f.id === id);
export const ROOM = { cols: 17, rows: 7 };
/** Every home starts with a bed (sleep), a desk (task book) and a bookcase (card case); these stay in the room. */
export const STARTER_FURNITURE = [{ id: 1, cx: 0, cy: 0 }, { id: 18, cx: 7, cy: 0 }, { id: 13, cx: 14, cy: 0 }];
export interface PlacedFurniture { id: number; furniture_id: number; cx: number; cy: number; locked: number }
/** Placement rule: inside the room, no overlap, and one empty tile between pieces. Rugs ignore the gap and can sit under things. */
export function furnitureFits(placed: PlacedFurniture[], item: Furniture, cx: number, cy: number, ignoreId = -1): boolean {
  if (cx < 0 || cy < 0 || cx + item.w > ROOM.cols || cy + item.h > ROOM.rows) return false;
  for (const p of placed) {
    if (p.id === ignoreId) continue;
    const o = furnitureById(p.furniture_id); if (!o) continue;
    const pad = item.kind === 'rug' || o.kind === 'rug' ? 0 : 1;
    const overlap = cx < p.cx + o.w + pad && cx + item.w + pad > p.cx && cy < p.cy + o.h + pad && cy + item.h + pad > p.cy;
    if (overlap && !(item.kind === 'rug' || o.kind === 'rug')) return false;
    if (overlap && item.kind === 'rug' && o.kind === 'rug') return false;
  }
  return true;
}

// ---------- shop rotation ----------
function seeded(seed: string) {
  let h = 2166136261;
  for (const ch of seed) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h += 0x6d2b79f5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const SHOP_PLANTS = 4, SHOP_FURNITURE = 4, SHOP_CARD_CHANCE = 0.3;
/** What the shop stocks for one user on one local day: a few seeds, a few furniture pieces and, rarely, one card. */
export function shopRotation(userId: number, day: string): { plants: number[]; furniture: number[]; card: number | null } {
  const rnd = seeded(`${userId}:${day}`);
  const pick = <T>(pool: T[], n: number) => { const p = [...pool], out: T[] = []; while (out.length < n && p.length) out.push(p.splice(Math.floor(rnd() * p.length), 1)[0]); return out; };
  const plants = [...pick(PLANTS.filter((p) => p.rarity === 'common'), 2), ...pick(PLANTS.filter((p) => p.rarity === 'uncommon'), 2)].map((p) => p.id);
  const furniture = pick(FURNITURE, SHOP_FURNITURE).map((f) => f.id);
  const card = rnd() < SHOP_CARD_CHANCE ? CARDS[Math.floor(rnd() * CARDS.length)].id : null;
  return { plants, furniture, card };
}

// ---------- time ----------
/** YYYY-MM-DD in the local day of the user. tzOffsetMin = Date.getTimezoneOffset() (minutes, positive west of UTC). */
export function dayKey(nowMs: number, tzOffsetMin: number): string { return new Date(nowMs - tzOffsetMin * 60_000).toISOString().slice(0, 10); }
export function addDays(day: string, n: number): string { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
export function daysBetween(a: string, b: string): number { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000); }

export function weightedPick<T extends string>(weights: Record<T, number>, rnd = Math.random()): T {
  const entries = Object.entries(weights) as [T, number][];
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rnd * total;
  for (const [k, w] of entries) { r -= w; if (r < 0) return k; }
  return entries[entries.length - 1][0];
}

// ---------- shared API shapes ----------
export interface UserState {
  id: number; username: string; friend_code: string; character: number | null;
  coins: number; gems: number; xp: number; streak: number; wither: number; frozen: number;
  music: number; sfx: number; pomo_work: number; pomo_break: number; pomo_reps: number;
  freezes_used: number; freeze_month: string; growth: number; tutorial_done: number; music_track: number; music_volume: number; is_admin: number; season: Season;
  fence_color: FenceColor;
}
export interface Plot { id: number; tx: number; ty: number; plant_id: number | null; stage: number; planted_at: number | null; ready_at: number | null }
export interface Task {
  id: number; name: string; description: string; folder: string; difficulty: number; est_minutes: number;
  due_date: string | null; priority: number;
  created_at: number; started_at: number | null; completed_at: number | null; actual_minutes: number | null;
  pomodoro: number; xp_awarded: number; coins_awarded: number;
}
export interface Daily { day: string; xp: number; coins: number; tasks_done: number; spun: number }
export interface MeResponse {
  user: UserState; plots: Plot[]; fences: FenceTile[]; inventory: { plant_id: number; qty: number }[]; cards: { card_id: number; slot: number | null }[];
  furniture: { furniture_id: number; qty: number }[]; placed: PlacedFurniture[];
  folders: string[]; seasons: Season[]; daily: Daily; stats: Record<string, number>; tasks: Task[]; freezesLeft: number;
}
export interface GardenView { owner: { id: number; username: string; character: number | null; level: number; wither: number; frozen: number; season: Season; fence_color: FenceColor; growth: number }; plots: Plot[]; fences: FenceTile[] }
export interface HouseView { owner: { id: number; username: string; character: number | null }; placed: PlacedFurniture[] }
export interface FriendRow { id: number; username: string; character: number | null; status: 'accepted' | 'incoming' | 'outgoing'; online: boolean; location: string | null }
export interface ShopInfo { plants: number[]; furniture: number[]; card: number | null; ownedCards: number[]; collected: number[]; day: string; daily: { spun: number } }
