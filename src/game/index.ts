import Phaser from 'phaser';
import { HouseScene } from './HouseScene';
import { GardenScene } from './GardenScene';
import { mountNavbar, tutorial, confirmDialog, isPomodoroActive } from '../ui/panels';
import { me, on, refreshMe, toast } from '../state';
import { music, setSfx, unlock, setVolume, setTrack } from '../ui/audio';
import { api } from '../api';
import { FRAME } from './Player';

import { W, H } from './tiles';
export { W, H };
export let game: Phaser.Game | null = null;

class Boot extends Phaser.Scene {
  constructor() { super('Boot'); }
  preload() {
    this.load.spritesheet('tinytown', '/assets/tiles/tinytown.png', { frameWidth: 16, frameHeight: 16 });
    this.load.spritesheet('inner', '/assets/tiles/inner.png', { frameWidth: 16, frameHeight: 16 });
    this.load.image('tinytown_img', '/assets/tiles/tinytown.png');
    this.load.image('inner_img', '/assets/tiles/inner.png');
    for (let i = 0; i < 3; i++) this.load.image(`crop_${i}`, `/assets/tiles/crop_${i}.png`);
    for (let i = 0; i < 24; i++) this.load.spritesheet(`char_${i}`, `/assets/chars/char_${i}.png`, { frameWidth: FRAME.w, frameHeight: FRAME.h });
    for (let i = 0; i < 36; i++) this.load.image(`plant_${i}`, `/assets/plants/plant_${i}.png`);
    for (let i = 0; i < 4; i++) this.load.image(`card_${i}`, `/assets/cards/card_${i}.png`);
    this.load.image('flower', '/assets/scenes/flower.png');
    this.load.image('book', '/assets/tiles/book.png');
  }
  create() {
    for (let i = 0; i < 24; i++) {
      const f = (a: number, b: number) => this.anims.generateFrameNumbers(`char_${i}`, { start: a, end: b });
      this.anims.create({ key: `idle_down_${i}`, frames: f(0, 1), frameRate: 2, repeat: -1 });
      this.anims.create({ key: `idle_up_${i}`, frames: f(2, 3), frameRate: 2, repeat: -1 });
      this.anims.create({ key: `walk_up_${i}`, frames: f(4, 7), frameRate: 9, repeat: -1 });
      this.anims.create({ key: `walk_down_${i}`, frames: f(8, 11), frameRate: 9, repeat: -1 });
    }
    this.scene.start('House', { spawn: 'center' });
  }
}

export async function startGame() {
  document.getElementById('game')!.style.display = 'block';
  mountNavbar();
  const u = me().user;
  setSfx(!!u.sfx); setVolume(u.music_volume); setTrack(u.music_track);
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
  setInterval(() => refreshMe().catch(() => {}), 60_000);
  on('me', () => { const s = game?.scene.getScenes(true)[0] as any; s?.onMe?.(); });
  if (!u.tutorial_done) setTimeout(tutorial, 1200);
}

/** Switch scene from UI code (map teleport, exits). A frozen garden blocks going to your own garden. */
export async function goto(scene: 'House' | 'Garden', data: Record<string, unknown> = {}) {
  const active = game?.scene.getScenes(true)[0];
  if (!active) return;
  if (scene === 'Garden' && data.ownerId === me().user.id && isPomodoroActive()) {
    toast('The garden is closed during a focus session', 'err');
    return;
  }
  if (scene === 'Garden' && data.ownerId === me().user.id && me().user.frozen) {
    const ok = await confirmDialog('Your farm is frozen', 'You cannot go to your farm when it is frozen. Would you like to unfreeze your farm?', 'Unfreeze', 'Stay inside');
    if (!ok) return;
    try { await api.post('/api/me/freeze', { on: false }); await refreshMe(); toast('Garden unfrozen'); } catch (e) { toast((e as Error).message, 'err'); return; }
  }
  active.scene.start(scene, data);
}
export function activeScene() { return game?.scene.getScenes(true)[0] as (Phaser.Scene & { uiOpen?: boolean }) | undefined; }
