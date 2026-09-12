import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taskReward, levelFromXp, xpToNext, timingMult, spinPayout, dayKey, daysBetween, addDays, plotPrice, gardenTiles, weightedPick, effectiveSeason } from '../src/shared/rules.ts';

test('reward scales with difficulty, time, timing, pomodoro', () => {
  assert.deepEqual(taskReward(1, 30, null, false), { xp: 15, coins: 8 });      // 10 * 1.5
  assert.deepEqual(taskReward(3, 300, null, false), { xp: 210, coins: 105 });  // 35 * 6
  assert.equal(taskReward(2, 60, 60, true).xp, 80);                            // 20*2 doubled by pomodoro
  assert.equal(taskReward(2, 60, 60, true).coins, 20);                         // coins never doubled
  assert.equal(timingMult(120, 60), 0.5);                                      // 2x over: floor
  assert.equal(timingMult(20, 60), 0.9);                                       // rushed
  assert.equal(timingMult(200, 60), 0.5);                                      // never below floor
});
test('levels + garden', () => {
  assert.equal(xpToNext(1), 100);
  assert.deepEqual(levelFromXp(0), { level: 1, into: 0, next: 100 });
  assert.deepEqual(levelFromXp(100), { level: 2, into: 0, next: 120 });
  assert.equal(levelFromXp(1e9).level, 20);
  assert.equal(levelFromXp(1e9).next, 0);
  assert.equal(gardenTiles(1), 12); assert.equal(gardenTiles(20), 32);
  assert.equal(plotPrice(3), 0); assert.equal(plotPrice(4), 50); assert.equal(plotPrice(6), 113);
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
