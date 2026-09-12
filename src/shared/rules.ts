/** Game rules shared by client and Worker. Pure functions + catalogs. No I/O. */

export const PALETTE = { sky: '#93AEBF', forest: '#103523', sage: '#BCCB9B', cream: '#F0EBCC', rose: '#CD9186', bark: '#745852' };

// ---------- currency + progression ----------
export const START = { coins: 100, gems: 10, plots: 4, seeds: { 1: 1, 2: 1 } as Record<number, number> };
export const DAILY_CAP = { xp: 600, coins: 300 };
export const MAX_LEVEL = 20;
export const BASE_XP: Record<number, number> = { 1: 10, 2: 20, 3: 35 };
export const GEM_PRICE_COINS = 25;
export const LOOTBOX_PRICE = 60;
export const SEASON_CHANGE_GEMS = 1;

export type Season = 'auto' | 'summer' | 'rainy' | 'fall' | 'winter';
export type GardenSeason = Exclude<Season, 'auto'>;
export const SEASONS: { value: Season; label: string; note: string }[] = [
  { value: 'auto', label: 'Auto', note: 'Matches the US season' },
  { value: 'summer', label: 'Summer', note: 'Sun and green grass' },
  { value: 'rainy', label: 'Rainy', note: 'Rain over the garden' },
  { value: 'fall', label: 'Fall', note: 'Red leaves and warm grass' },
  { value: 'winter', label: 'Winter', note: 'Snow and pale grass' },
];
/** Auto uses US meteorological seasons. Spring uses the rainy garden theme. */
export function effectiveSeason(setting: Season, month: number): GardenSeason {
  if (setting !== 'auto') return setting;
  if (month === 11 || month <= 1) return 'winter';
  if (month <= 4) return 'rainy';
  if (month <= 7) return 'summer';
  return 'fall';
}

export function xpToNext(level: number): number { return Math.round(100 * Math.pow(1.2, level - 1)); }
export function levelFromXp(xp: number): { level: number; into: number; next: number } {
  let level = 1, rem = xp;
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
export function gardenTiles(level: number): number { return Math.min(12 + 2 * (level - 1), 32); }
export function plotsUnlocked(level: number): number { return START.plots + 2 * (level - 1); }
export function plotPrice(owned: number): number { return owned < START.plots ? 0 : Math.round(50 * Math.pow(1.5, owned - START.plots)); }
export const STAGES = 3; // stage 0 seed, 1 sprout, 2 growing, 3 mature
export const STAGE_FEED_COINS = [20, 40, 80];
export const STAGE_MS = [1, 4, 12].map((h) => h * 3600_000);
export const WITHER_MAX = 4;
export const FREEZES_PER_MONTH = 2;
/** Growth pace preference (settings): timer multiplier in percent and the matching feed-cost multiplier. */
export const GROWTH_OPTIONS = [
  { value: 50, label: 'Quick', desc: 'half the wait, double the feed cost', cost: 2 },
  { value: 100, label: 'Normal', desc: '1h / 4h / 12h', cost: 1 },
  { value: 200, label: 'Patient', desc: 'twice the wait, half the feed cost', cost: 0.5 },
] as const;
export function growthCost(stage: number, growth: number): number { const o = GROWTH_OPTIONS.find((g) => g.value === growth) ?? GROWTH_OPTIONS[1]; return Math.round(STAGE_FEED_COINS[stage] * o.cost); }
export function growthMs(stage: number, growth: number): number { return Math.round(STAGE_MS[stage] * (growth / 100)); }

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
export interface Plant { id: number; name: string; sprite: number; rarity: Rarity; price: number }
export const PLANTS: Plant[] = [
  { id: 1, name: 'Sunflower', sprite: 14, rarity: 'common', price: 80 },
  { id: 2, name: 'Tulip', sprite: 28, rarity: 'common', price: 70 },
  { id: 3, name: 'Daisy', sprite: 29, rarity: 'common', price: 60 },
  { id: 4, name: 'Lavender', sprite: 34, rarity: 'common', price: 90 },
  { id: 5, name: 'Wheat', sprite: 17, rarity: 'common', price: 60 },
  { id: 6, name: 'Rose', sprite: 24, rarity: 'uncommon', price: 140 },
  { id: 7, name: 'Cactus', sprite: 19, rarity: 'uncommon', price: 120 },
  { id: 8, name: 'Fern', sprite: 18, rarity: 'uncommon', price: 130 },
  { id: 9, name: 'Cattails', sprite: 15, rarity: 'uncommon', price: 110 },
  { id: 10, name: 'Mushroom', sprite: 31, rarity: 'uncommon', price: 100 },
  { id: 11, name: 'Pine', sprite: 3, rarity: 'uncommon', price: 160 },
  { id: 12, name: 'Lotus', sprite: 33, rarity: 'rare', price: 260 },
  { id: 13, name: 'Lucky Clover', sprite: 35, rarity: 'rare', price: 280 },
  { id: 14, name: 'Cherry Blossom', sprite: 27, rarity: 'rare', price: 320 },
  { id: 15, name: 'Apple Tree', sprite: 1, rarity: 'rare', price: 350 },
  { id: 16, name: 'Venus Flytrap', sprite: 13, rarity: 'rare', price: 500 },
];
export const LOOTBOX_WEIGHTS: Record<Rarity, number> = { common: 70, uncommon: 25, rare: 5, epic: 0 };
export const plantById = (id: number) => PLANTS.find((p) => p.id === id);

export interface Card { id: number; name: string; rarity: Rarity; price: number; art: boolean }
export const CARDS: Card[] = [
  { id: 0, name: 'Mountain Fox', rarity: 'common', price: 5, art: true },
  { id: 1, name: 'Forest Owl', rarity: 'common', price: 5, art: true },
  { id: 2, name: 'Golden Koi', rarity: 'uncommon', price: 10, art: true },
  { id: 3, name: 'Sakura Stag', rarity: 'uncommon', price: 10, art: true },
  { id: 4, name: 'Red Panda', rarity: 'common', price: 5, art: false },
  { id: 5, name: 'Snow Hare', rarity: 'common', price: 5, art: false },
  { id: 6, name: 'River Otter', rarity: 'uncommon', price: 10, art: false },
  { id: 7, name: 'Moon Moth', rarity: 'uncommon', price: 10, art: false },
  { id: 8, name: 'Amber Lynx', rarity: 'rare', price: 20, art: false },
  { id: 9, name: 'Glacier Wolf', rarity: 'rare', price: 20, art: false },
  { id: 10, name: 'Ember Phoenix', rarity: 'epic', price: 40, art: false },
  { id: 11, name: 'Jade Dragon', rarity: 'epic', price: 40, art: false },
];
export function caseSlots(level: number): number { return 6 + 2 * Math.floor((level - 1) / 5); }

export interface Furniture { id: number; name: string; price: number; kind: 'plant' | 'chair' | 'dresser' | 'rug' | 'bookcase' | 'sideboard' }
export const FURNITURE: Furniture[] = [
  { id: 1, name: 'Room Fern', price: 35, kind: 'plant' },
  { id: 2, name: 'Reading Chair', price: 55, kind: 'chair' },
  { id: 3, name: 'Small Dresser', price: 70, kind: 'dresser' },
  { id: 4, name: 'Garden Rug', price: 85, kind: 'rug' },
  { id: 5, name: 'Bookcase', price: 110, kind: 'bookcase' },
  { id: 6, name: 'Wood Sideboard', price: 125, kind: 'sideboard' },
];
export const FURNITURE_SLOTS = 4;

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
}
export interface Plot { id: number; tx: number; ty: number; plant_id: number | null; stage: number; ready_at: number | null }
export interface Task {
  id: number; name: string; description: string; folder: string; difficulty: number; est_minutes: number;
  due_date: string | null; priority: number;
  created_at: number; started_at: number | null; completed_at: number | null; actual_minutes: number | null;
  pomodoro: number; xp_awarded: number; coins_awarded: number;
}
export interface Daily { day: string; xp: number; coins: number; tasks_done: number; spun: number }
export interface MeResponse {
  user: UserState; plots: Plot[]; inventory: { plant_id: number; qty: number }[]; cards: { card_id: number; slot: number | null }[];
  furniture: { furniture_id: number; slot: number | null }[];
  folders: string[]; daily: Daily; stats: Record<string, number>; tasks: Task[]; freezesLeft: number;
}
export interface GardenView { owner: { id: number; username: string; character: number | null; level: number; wither: number; frozen: number; season: Season }; plots: Plot[] }
export interface FriendRow { id: number; username: string; character: number | null; status: 'accepted' | 'incoming' | 'outgoing'; online: boolean; location: string | null }
