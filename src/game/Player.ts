import Phaser from 'phaser';
import { sfx } from '../ui/audio';

import { movementDirection, movementView, type Dir } from '../shared/movement';
export type { Dir } from '../shared/movement';
export const WALK = 230, RUN = 380;
export const FRAME = { w: 160, h: 140 };
export const CHARACTERS = 20;

/**
 * Eight-direction movement with normalized speed and frame-based animation.
 * Physics owns x/y; turning and changing pace preserve the walking cycle.
 */
export class Player extends Phaser.Physics.Arcade.Sprite {
  dir: Dir = 'down';
  moving = false;
  running = false;
  typing = false;
  label: Phaser.GameObjects.Text;
  bubble?: Phaser.GameObjects.Container;
  private stepTimer = 0;
  private emoteTween?: Phaser.Tweens.Tween;
  constructor(scene: Phaser.Scene, x: number, y: number, public character: number, name: string, public isLocal: boolean, scale = 1) {
    super(scene, x, y, `char_${character}`, 0);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setOrigin(0.5, 1);
    this.setScale(scale);
    this.body!.setSize(40, 20).setOffset((FRAME.w - 40) / 2, 118);
    this.label = scene.add.text(x, y - FRAME.h * this.scaleY - 6, name, { fontFamily: 'Pixelify Sans', fontSize: '16px', color: '#F0EBCC', stroke: '#103523', strokeThickness: 4 }).setOrigin(0.5, 1);
    this.play(`idle_down_${character}`);
  }

  /** Local: desired unit direction + run flag. Remote: applied state. */
  drive(vx: number, vy: number, run: boolean, dt: number) {
    this.setVelocity(vx, vy);
    const speed = run ? RUN : WALK;
    if (vx || vy) this.body!.velocity.normalize().scale(speed);
    const moving = !!(vx || vy);
    this.setFacing(movementDirection(vx, vy, this.dir), moving, moving && run);
    if (moving && this.isLocal) { this.stepTimer += dt; if (this.stepTimer > (run ? 180 : 280)) { this.stepTimer = 0; sfx.step(); } }
    if (!moving) this.stepTimer = 0;
  }
  setFacing(dir: Dir, moving: boolean, running = false) {
    if (dir === this.dir && moving === this.moving && running === this.running) return;
    const wasMoving = this.moving;
    const frameIndex = (this.anims.currentFrame?.index ?? 1) - 1;
    this.dir = dir; this.moving = moving; this.running = running;
    this.setFlipX(dir.endsWith('left'));
    const view = movementView(dir);
    const key = `${moving ? 'walk' : 'idle'}_${view}_${this.character}`;
    if (this.anims.currentAnim?.key !== key) {
      const frames = this.scene.anims.get(key).frames.length;
      this.play({ key, startFrame: wasMoving && moving ? frameIndex % frames : 0 });
    }
    this.anims.timeScale = moving && running ? RUN / WALK : 1;
  }
  preUpdate(t: number, dt: number) {
    super.preUpdate(t, dt);
    this.setDepth(this.y);
    this.label.setPosition(this.x, this.y - FRAME.h * this.scaleY - 6).setDepth(this.y + 1);
    this.bubble?.setPosition(this.x, this.y - FRAME.h * this.scaleY - 20).setDepth(this.y + 2);
  }
  say(text: string, ms = 5000) {
    this.clearBubble();
    const s = this.scene;
    const txt = s.add.text(0, 0, text, { fontFamily: 'Nunito', fontSize: '15px', color: '#2b2118', wordWrap: { width: 220 } }).setOrigin(0.5, 1);
    const bg = s.add.graphics();
    const w = txt.width + 18, h = txt.height + 12;
    bg.fillStyle(0xf5e9d0, 1).lineStyle(3, 0x745852, 1).fillRoundedRect(-w / 2, -h - 8, w, h, 6).strokeRoundedRect(-w / 2, -h - 8, w, h, 6);
    bg.fillTriangle(-7, -8, 7, -8, 0, 1);
    txt.setY(-14);
    this.bubble = s.add.container(this.x, this.y - FRAME.h * this.scaleY - 20, [bg, txt]);
    if (ms > 0) s.time.delayedCall(ms, () => { if (this.bubble?.getAt(1) === txt) this.clearBubble(); });
  }
  clearBubble() { this.bubble?.destroy(); this.bubble = undefined; }
  /** Wave: a quick lean left/right plus a hand bubble. Used for both local and remote players. */
  emote(kind: string) {
    if (kind === 'wave') {
      this.say('👋', 1500);
      this.emoteTween?.stop();
      this.emoteTween = this.scene.tweens.add({ targets: this, angle: { from: -6, to: 6 }, duration: 160, yoyo: true, repeat: 3, onComplete: () => this.setAngle(0) });
    } else if (kind === 'sleep') this.say('z z Z', 2500);
  }
  destroy(fromScene?: boolean) { this.label.destroy(); this.clearBubble(); this.emoteTween?.stop(); super.destroy(fromScene); }
}

/** Reads WASD / arrows into a unit direction + run (shift). */
export function readInput(k: Record<string, Phaser.Input.Keyboard.Key>): [number, number, boolean] {
  const vx = (k.right.isDown || k.d.isDown ? 1 : 0) - (k.left.isDown || k.a.isDown ? 1 : 0);
  const vy = (k.down.isDown || k.s.isDown ? 1 : 0) - (k.up.isDown || k.w.isDown ? 1 : 0);
  return [vx, vy, k.shift.isDown];
}
export function makeKeys(scene: Phaser.Scene) {
  const kb = scene.input.keyboard!;
  kb.disableGlobalCapture(); // never preventDefault: typing W/A/S/D in inputs must work
  return kb.addKeys({ up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT', w: 'W', a: 'A', s: 'S', d: 'D', shift: 'SHIFT' }, false) as Record<string, Phaser.Input.Keyboard.Key>;
}
/** True when an HTML input has focus: the game must ignore keys then. */
export function typingInDom() {
  const t = document.activeElement as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
}
