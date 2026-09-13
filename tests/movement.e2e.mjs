import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const state = { user: { id: 1, username: 'Walker', character: 13, friend_code: 'TEST', coins: 100, gems: 10, xp: 400, streak: 3, wither: 0, frozen: 0, music: 0, sfx: 0, tutorial_done: 1, season: 'summer', fence_color: 'brown', growth: 1, pomo_work: 25, pomo_break: 5, pomo_reps: 4, music_volume: 0 }, plots: [], fences: [], inventory: [], cards: [], furniture: [], placed: [], folders: [], seasons: ['summer'], daily: { xp: 0, coins: 0, tasks_done: 0, spun: 1 }, stats: {}, tasks: [], freezesLeft: 3 };
await page.route('**/api/**', route => route.fulfill({ json: new URL(route.request().url()).pathname === '/api/me' ? state : {} }));
await page.routeWebSocket(/\/ws\//, () => {});

try {
  await page.goto('http://127.0.0.1:5173');
  await page.waitForFunction(() => window.__game?.scene.getScene('House')?.player?.body);
  const result = await page.evaluate(async () => {
    const { Player, WALK, RUN, readInput } = await import('/src/game/Player.ts');
    const scene = window.__game.scene.getScene('House');
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    const directions = [
      [0, -1, 'up', 'up', false], [1, -1, 'up-right', 'up', false],
      [1, 0, 'right', 'side', false], [1, 1, 'down-right', 'side', false],
      [0, 1, 'down', 'down', false], [-1, 1, 'down-left', 'side', true],
      [-1, 0, 'left', 'side', true], [-1, -1, 'up-left', 'up', true],
    ];
    for (const character of [13, 4, 0]) {
      const p = new Player(scene, 600, 600, character, 'Test', false);
      for (const [x, y, dir, view, flip] of directions) {
        // Never stop between turns: this catches the stale-facing regression.
        p.drive(x, y, false, 16);
        check(p.dir === dir && p.flipX === flip, `c${character + 1}: facing ${dir}`);
        check(p.anims.currentAnim.key === `walk_${view}_${character}`, `c${character + 1}: animation ${dir}`);
        check(Math.abs(p.body.velocity.length() - WALK) < 0.001, `Unequal speed ${dir}`);
        check(Math.sign(p.body.velocity.x) === x && Math.sign(p.body.velocity.y) === y, `Wrong velocity ${dir}`);
      }
      const cycle = p.anims.currentAnim;
      p.anims.setCurrentFrame(cycle.frames[1]);
      const frame = p.anims.currentFrame;
      p.drive(-1, -1, true, 16);
      check(p.anims.currentFrame === frame, 'Running restarted the animation');
      check(Math.abs(p.body.velocity.length() - RUN) < 0.001, 'Wrong run speed');
      check(p.anims.timeScale === RUN / WALK, 'Running did not speed up the animation');
      p.drive(1, 0, true, 16);
      check(p.anims.currentFrame.index === frame.index, 'Turning reset the walking phase');
      p.drive(0, 0, false, 16);
      check(p.dir === 'right' && !p.moving && p.body.velocity.length() === 0, 'Stopping did not preserve facing');
      check(p.anims.currentAnim.key === `idle_side_${character}` && p.anims.timeScale === 1, 'Idle inherited running speed');
      for (const view of ['down', 'up', 'side']) {
        const walk = scene.anims.get(`walk_${view}_${character}`);
        check(walk.frames.length === (character === 0 ? 2 : 4), 'Wrong frame count');
        check(new Set(walk.frames.map(frame => frame.textureFrame)).size === walk.frames.length, 'Duplicate walk frame IDs');
      }
      const keys = Object.fromEntries(['up', 'down', 'left', 'right', 'w', 'a', 's', 'd', 'shift'].map(k => [k, { isDown: false }]));
      for (const [x, y] of directions) {
        for (const aliases of [['up', 'down', 'left', 'right'], ['w', 's', 'a', 'd']]) {
          Object.values(keys).forEach(key => key.isDown = false);
          if (x) keys[aliases[x < 0 ? 2 : 3]].isDown = true;
          if (y) keys[aliases[y < 0 ? 0 : 1]].isDown = true;
          check(JSON.stringify(readInput(keys)) === JSON.stringify([x, y, false]), 'WASD/arrows direction mismatch');
        }
      }
      Object.values(keys).forEach(key => key.isDown = true);
      check(JSON.stringify(readInput(keys)) === '[0,0,true]', 'Opposite inputs should cancel');
      p.destroy();
    }
    return true;
  });
  assert.equal(result, true);
  // Exercise real keyboard events through the scene update, including a turn
  // while one key is still held and a release back to a cardinal direction.
  await page.keyboard.down('ArrowRight');
  await page.waitForFunction(() => window.__game.scene.getScene('House').player.dir === 'right');
  await page.keyboard.down('ArrowUp');
  await page.waitForFunction(() => window.__game.scene.getScene('House').player.dir === 'up-right');
  await page.keyboard.up('ArrowRight');
  await page.waitForFunction(() => window.__game.scene.getScene('House').player.dir === 'up');
  await page.keyboard.up('ArrowUp');
  await page.waitForFunction(() => !window.__game.scene.getScene('House').player.moving);
  await page.screenshot({ path: 'out/c14-walking.png' });
  assert.deepEqual(errors, []);
  console.log('PASS: c14, c5 and legacy character: eight directions, normalized speeds, turns without stopping, run phase, idle, WASD/arrows, opposing keys and live keyboard input.');
} finally {
  await browser.close();
}
