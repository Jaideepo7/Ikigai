import Phaser from 'phaser';
import { HouseScene } from './HouseScene';
import { GardenScene } from './GardenScene';
import { mountNavbar } from '../ui/panels';
import { me, on, refreshMe } from '../state';
import { music, setSfx, unlock } from '../ui/audio';

export const W = 1440, H = 848;
export let game: Phaser.Game | null = null;

/** Boot scene: load everything once. Character sheets are tiny, so all 24 are loaded up front. */
class Boot extends Phaser.Scene {
  constructor() { super('Boot'); }
  preload() {
    this.load.image('house', '/assets/scenes/house.png');
    for (const n of ['house_facade', 'tree_big', 'bush_round', 'barrel', 'barrel2', 'mailbox', 'bench', 'chest', 'stone', 'bench2', 'fence_h', 'fence_v', 'tile_grass', 'flower', 'tile_path', 'tile_dirt']) this.load.image(n, `/assets/scenes/${n}.png`);
    for (let i = 0; i < 24; i++) this.load.spritesheet(`char_${i}`, `/assets/chars/char_${i}.png`, { frameWidth: 72, frameHeight: 104 });
    for (let i = 0; i < 36; i++) this.load.image(`plant_${i}`, `/assets/plants/plant_${i}.png`);
    for (let i = 0; i < 4; i++) this.load.image(`card_${i}`, `/assets/cards/card_${i}.png`);
  }
  create() {
    for (let i = 0; i < 24; i++) {
      this.anims.create({ key: `walk_up_${i}`, frames: this.anims.generateFrameNumbers(`char_${i}`, { start: 2, end: 5 }), frameRate: 8, repeat: -1 });
    }
    this.scene.start('House', { spawn: 'center' });
  }
}

export async function startGame() {
  document.getElementById('game')!.style.display = 'block';
  mountNavbar();
  const u = me().user;
  setSfx(!!u.sfx);
  const kick = () => { unlock(); if (u.music) music(true); window.removeEventListener('pointerdown', kick); window.removeEventListener('keydown', kick); };
  window.addEventListener('pointerdown', kick); window.addEventListener('keydown', kick);
  if (game) return;
  game = new Phaser.Game({
    type: Phaser.AUTO, parent: 'game', width: W, height: H, pixelArt: true, backgroundColor: '#0b0f0a',
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    physics: { default: 'arcade', arcade: { debug: false } },
    scene: [Boot, HouseScene, GardenScene],
  });
  (window as any).__game = game; // debugging hook (used by tests/debug_move.mjs)
  // keep server state fresh while playing (growth timers, friends' presence)
  setInterval(() => refreshMe().catch(() => {}), 60_000);
  on('me', () => { const s = game?.scene.getScenes(true)[0] as any; s?.onMe?.(); });
}

/** Switch scene from UI code (map teleport, exits). */
export function goto(scene: 'House' | 'Garden', data: Record<string, unknown> = {}) {
  const active = game?.scene.getScenes(true)[0];
  if (!active) return;
  active.scene.start(scene, data);
}
export function activeScene() { return game?.scene.getScenes(true)[0] as (Phaser.Scene & { uiOpen?: boolean }) | undefined; }
