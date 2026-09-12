import Phaser from 'phaser';
import { sfx } from '../ui/audio';

export type Dir = 'up' | 'down' | 'left' | 'right';
const SPEED = 230;

/**
 * A gardener sprite. Frames: 0 front, 1 back, 2-5 back-walk cycle.
 * ponytail: no side-view art exists, so left/right reuse the front frame (mirrored) with a bob tween.
 */
export class Player extends Phaser.Physics.Arcade.Sprite {
  dir: Dir = 'down';
  moving = false;
  label: Phaser.GameObjects.Text;
  bubble?: Phaser.GameObjects.Container;
  private bob?: Phaser.Tweens.Tween;
  private breathe: Phaser.Tweens.Tween;
  private stepTimer = 0;
  constructor(scene: Phaser.Scene, x: number, y: number, public character: number, name: string, public isLocal: boolean) {
    super(scene, x, y, `char_${character}`, 0);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setOrigin(0.5, 1);
    this.body!.setSize(34, 18).setOffset(19, 86);
    this.label = scene.add.text(x, y - 110, name, { fontFamily: 'Pixelify Sans', fontSize: '15px', color: '#F0EBCC', stroke: '#103523', strokeThickness: 4 }).setOrigin(0.5, 1);
    this.breathe = scene.tweens.add({ targets: this, scaleX: 1.03, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
  }

  /** Called every frame by the scene with the desired velocity (local) or applied state (remote). */
  drive(vx: number, vy: number, dt: number) {
    this.setVelocity(vx, vy);
    if (vx || vy) this.body!.velocity.normalize().scale(SPEED);
    const moving = !!(vx || vy);
    if (moving) this.dir = Math.abs(vx) > Math.abs(vy) ? (vx < 0 ? 'left' : 'right') : vy < 0 ? 'up' : 'down';
    this.setFacing(this.dir, moving);
    if (moving && this.isLocal) { this.stepTimer += dt; if (this.stepTimer > 260) { this.stepTimer = 0; sfx.step(); } }
  }
  setFacing(dir: Dir, moving: boolean) {
    const changed = dir !== this.dir || moving !== this.moving;
    this.dir = dir; this.moving = moving;
    if (!changed) return;
    this.setFlipX(dir === 'left');
    if (dir === 'up') {
      this.bob?.stop(); this.bob = undefined; this.setOrigin(0.5, 1);
      if (moving) this.play(`walk_up_${this.character}`, true); else { this.stop(); this.setFrame(1); }
    } else {
      this.stop(); this.setFrame(0);
      // tween the origin, not y: arcade physics owns y and a y-tween would cancel vertical movement
      if (moving && !this.bob) this.bob = this.scene.tweens.add({ targets: this, originY: 1.04, duration: 130, yoyo: true, repeat: -1 });
      if (!moving && this.bob) { this.bob.stop(); this.bob = undefined; this.setOrigin(0.5, 1); }
    }
    this.breathe.paused = moving;
    if (!moving) this.setScale(1, 1);
  }
  preUpdate(t: number, dt: number) {
    super.preUpdate(t, dt);
    this.setDepth(this.y);
    this.label.setPosition(this.x, this.y - 108).setDepth(this.y + 1);
    this.bubble?.setPosition(this.x, this.y - 124).setDepth(this.y + 2);
  }
  say(text: string, ms = 5000) {
    this.clearBubble();
    const s = this.scene;
    const txt = s.add.text(0, 0, text, { fontFamily: 'Nunito', fontSize: '14px', color: '#2b2118', wordWrap: { width: 200 } }).setOrigin(0.5, 1);
    const bg = s.add.graphics();
    const w = txt.width + 16, h = txt.height + 10;
    bg.fillStyle(0xf5e9d0, 1).lineStyle(3, 0x745852, 1).fillRoundedRect(-w / 2, -h - 6, w, h, 6).strokeRoundedRect(-w / 2, -h - 6, w, h, 6);
    bg.fillTriangle(-6, -6, 6, -6, 0, 2);
    txt.setY(-11);
    this.bubble = s.add.container(this.x, this.y - 124, [bg, txt]);
    if (ms > 0) s.time.delayedCall(ms, () => { if (this.bubble?.getAt(1) === txt) this.clearBubble(); });
  }
  clearBubble() { this.bubble?.destroy(); this.bubble = undefined; }
  destroy(fromScene?: boolean) { this.label.destroy(); this.clearBubble(); this.breathe.stop(); this.bob?.stop(); super.destroy(fromScene); }
}

/** Reads WASD / arrows into a unit direction. */
export function readInput(k: Record<string, Phaser.Input.Keyboard.Key>): [number, number] {
  const vx = (k.right.isDown || k.d.isDown ? 1 : 0) - (k.left.isDown || k.a.isDown ? 1 : 0);
  const vy = (k.down.isDown || k.s.isDown ? 1 : 0) - (k.up.isDown || k.w.isDown ? 1 : 0);
  return [vx, vy];
}
export function makeKeys(scene: Phaser.Scene) {
  const kb = scene.input.keyboard!;
  return kb.addKeys({ up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT', w: 'W', a: 'A', s: 'S', d: 'D' }) as Record<string, Phaser.Input.Keyboard.Key>;
}
