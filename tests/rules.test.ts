import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  taskReward, levelFromXp, xpToNext, xpForLevel, timingMult, spinPayout, dayKey, daysBetween, addDays, gardenTiles, plotsUnlocked, weightedPick, effectiveSeason,
  fencePiece, defaultFences, plantStage, growMs, plantReward, plantById, furnitureFits, shopRotation, FURNITURE, PLANTS, CARDS, STAGES, SPROUT_MS, furnitureById,
} from '../src/shared/rules.ts';

test('reward scales with difficulty, time, timing, pomodoro', () => {
  assert.deepEqual(taskReward(1, 30, null, false), { xp: 15, coins: 8 });      // 10 * 1.5
  assert.deepEqual(taskReward(3, 300, null, false), { xp: 210, coins: 105 });  // 35 * 6
  assert.equal(taskReward(2, 60, 60, true).xp, 80);                            // 20*2 doubled by pomodoro
  assert.equal(taskReward(2, 60, 60, true).coins, 20);                         // coins never doubled
  assert.equal(timingMult(120, 60), 0.5);                                      // 2x over: floor
  assert.equal(timingMult(20, 60), 0.9);                                       // rushed
  assert.equal(timingMult(200, 60), 0.5);                                      // never below floor
});
test('levels 0-100 + garden size', () => {
  assert.equal(xpToNext(0), 100); assert.equal(xpToNext(10), 350);
  assert.deepEqual(levelFromXp(0), { level: 0, into: 0, next: 100 });
  assert.deepEqual(levelFromXp(100), { level: 1, into: 0, next: 125 });
  assert.equal(xpForLevel(0), 0); assert.equal(xpForLevel(1), 100); assert.equal(xpForLevel(2), 225);
  for (const l of [0, 1, 5, 30, 77, 100]) assert.equal(levelFromXp(xpForLevel(l)).level, l);
  assert.equal(levelFromXp(1e9).level, 100); assert.equal(levelFromXp(1e9).next, 0);
  assert.equal(gardenTiles(0), 12); assert.equal(gardenTiles(4), 12); assert.equal(gardenTiles(5), 13); assert.equal(gardenTiles(100), 32); assert.equal(gardenTiles(150), 32);
  assert.equal(plotsUnlocked(0), 6); assert.equal(plotsUnlocked(10), 16);
});
test('growth: seed -> twig after 10s -> young at half -> mature, trees take twice as long', () => {
  const rose = plantById(1)!, oak = plantById(21)!;
  assert.equal(growMs(rose, 50), 10 * 60_000); assert.equal(growMs(rose, 100), 20 * 60_000); assert.equal(growMs(rose, 200), 30 * 60_000);
  assert.equal(growMs(oak, 200), 60 * 60_000);
  const t0 = 1_000_000, p = { plant_id: 1, stage: 0, planted_at: t0, ready_at: t0 + 600_000 };
  assert.equal(plantStage(p, t0 + 5_000), 0);
  assert.equal(plantStage(p, t0 + SPROUT_MS), 1);
  assert.equal(plantStage(p, t0 + 299_000), 1);
  assert.equal(plantStage(p, t0 + 300_000), 2);
  assert.equal(plantStage(p, t0 + 600_000), STAGES);
  assert.equal(plantStage({ plant_id: 1, stage: 3, planted_at: null, ready_at: null }, t0), STAGES);
  assert.equal(plantStage({ plant_id: null, stage: 0, planted_at: null, ready_at: null }, t0), -1);
  assert.deepEqual(plantReward(rose, 50), { xp: 15, coins: 8 }); assert.deepEqual(plantReward(rose, 200), { xp: 30, coins: 15 });
  assert.equal(PLANTS.length, 32); assert.equal(PLANTS.filter((x) => x.kind === 'tree').length, 12);
});
test('fence autotiling covers every neighbour combination', () => {
  assert.equal(fencePiece(false, false, false, false), 'post');
  assert.equal(fencePiece(false, true, false, true), 'h_m'); assert.equal(fencePiece(true, false, true, false), 'v_m');
  assert.equal(fencePiece(false, true, false, false), 'h_l'); assert.equal(fencePiece(false, false, false, true), 'h_r');
  assert.equal(fencePiece(false, false, true, false), 'v_t'); assert.equal(fencePiece(true, false, false, false), 'v_b');
  assert.equal(fencePiece(false, true, true, false), 'tl'); assert.equal(fencePiece(false, false, true, true), 'tr');
  assert.equal(fencePiece(true, true, false, false), 'bl'); assert.equal(fencePiece(true, false, false, true), 'br');
  assert.equal(fencePiece(false, true, true, true), 't_down'); assert.equal(fencePiece(true, true, false, true), 't_up');
  assert.equal(fencePiece(true, true, true, false), 't_right'); assert.equal(fencePiece(true, false, true, true), 't_left');
  assert.equal(fencePiece(true, true, true, true), 'cross');
  const ring = defaultFences(12);
  assert.equal(ring.length, 4 * 10 - 4); assert.equal(ring.filter((f) => f.kind === 'gate').length, 1);
  assert.ok(ring.every((f) => f.tx >= 1 && f.tx <= 10 && f.ty >= 1 && f.ty <= 10));
});
test('furniture placement: bounds, overlap, one-tile gap, rugs exempt', () => {
  const bed = furnitureById(1)!, chair = furnitureById(24)!, rug = furnitureById(33)!;
  const placed = [{ id: 1, furniture_id: 1, cx: 0, cy: 0, locked: 1 }];
  assert.equal(furnitureFits(placed, chair, 3, 0), true);
  assert.equal(furnitureFits(placed, chair, 2, 0), false);     // touching the bed: needs a gap
  assert.equal(furnitureFits(placed, chair, 1, 1), false);     // overlapping
  assert.equal(furnitureFits(placed, chair, -1, 0), false); assert.equal(furnitureFits(placed, bed, 16, 6), false);
  assert.equal(furnitureFits(placed, rug, 0, 0), true);        // rug under the bed
  assert.equal(furnitureFits([...placed, { id: 2, furniture_id: 33, cx: 5, cy: 5, locked: 0 }], chair, 5, 5), true); // chair on a rug
  assert.equal(furnitureFits([{ id: 3, furniture_id: 33, cx: 5, cy: 5, locked: 0 }], rug, 6, 5), false);           // rug on rug
  assert.equal(furnitureFits(placed, bed, 0, 0, 1), true);     // moving itself
  assert.equal(FURNITURE.length, 40);
});
test('shop rotation is stable per user + day and rarely stocks a card', () => {
  const a = shopRotation(7, '2026-09-12'), b = shopRotation(7, '2026-09-12'), c = shopRotation(8, '2026-09-12');
  assert.deepEqual(a, b); assert.notDeepEqual(a.plants, c.plants);
  assert.equal(a.plants.length, 4); assert.equal(new Set(a.plants).size, 4); assert.equal(a.furniture.length, 4);
  let cards = 0; for (let d = 1; d <= 200; d++) if (shopRotation(1, `2026-01-${d}`).card !== null) cards++;
  assert.ok(cards > 30 && cards < 90, `cards in 200 days: ${cards}`);
  assert.equal(CARDS.length, 4);
});
test('spin', () => {
  assert.deepEqual(spinPayout(['gem', 'gem', 'gem'], 0), { coins: 50, gems: 5 });
  assert.deepEqual(spinPayout(['coin', 'coin', 'coin'], 30), { coins: 750, gems: 0 }); // (50+200)*3, bonus capped
  assert.deepEqual(spinPayout(['coin', 'gem', 'sprout'], 100), { coins: 250, gems: 1 });
});
test('days', () => {
  const t = Date.UTC(2026, 8, 12, 3, 0); // 03:00Z = Sep 11 22:00 in UTC-5
  assert.equal(dayKey(t, 300), '2026-09-11');
  assert.equal(dayKey(t, 0), '2026-09-12');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(daysBetween('2026-09-01', '2026-09-12'), 11);
  assert.equal(weightedPick({ a: 0, b: 1 }, 0.5), 'b');
  assert.equal(weightedPick({ a: 1, b: 1 }, 0.999), 'b');
});
test('automatic US seasons', () => {
  assert.equal(effectiveSeason('auto', 11), 'winter');
  assert.equal(effectiveSeason('auto', 3), 'rainy');
  assert.equal(effectiveSeason('auto', 6), 'summer');
  assert.equal(effectiveSeason('auto', 9), 'fall');
  assert.equal(effectiveSeason('fall', 0), 'fall');
});
