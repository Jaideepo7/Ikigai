import Phaser from 'phaser';
import { HouseScene } from './HouseScene';
import { GardenScene } from './GardenScene';
import { mountNavbar, tutorial, confirmDialog, isPomodoroActive, refreshFriendsIfOpen, knockPrompt } from '../ui/panels';
import { me, on, refreshMe, toast, bus } from '../state';
import { music, setSfx, unlock, setVolume, setTrack } from '../ui/audio';
import { api } from '../api';
import { FRAME, CHARACTERS } from './Player';
import { connectHub, hubVisit, type KnockEvent } from './hub';
import { detachDomain, domainOwnerId, domainNet } from './domainNet';
import { FENCE_COLORS, FURNITURE } from '../shared/rules';

import { W, H } from './tiles';
export { W, H };
export let game: Phaser.Game | null = null;
export const FENCE_PIECES = ['post', 'h_l', 'h_m', 'h_m2', 'h_r', 'v_t', 'v_m', 'v_m2', 'v_b', 'tl', 'tr', 'bl', 'br', 't_up', 't_down', 't_left', 't_right', 'cross', 'gate', 'gate_open'];
export const POMODORO_LOCK_MSG = 'Garden access is disabled during an active focus session.';

class Boot extends Phaser.Scene {
  constructor() { super('Boot'); }
  preload() {
    this.load.spritesheet('tinytown', '/assets/tiles/tinytown.png', { frameWidth: 16, frameHeight: 16 });
    this.load.image('tinytown_img', '/assets/tiles/tinytown.png');
    for (let i = 0; i < CHARACTERS; i++) this.load.spritesheet(`char_${i}`, `/assets/chars/char_${i}.png?v=160x140`, { frameWidth: FRAME.w, frameHeight: FRAME.h });
    for (let i = 1; i <= 20; i++) this.load.image(`flower_${i}`, `/assets/plants/flower_${i}.png`);
    this.load.image('twig', '/assets/plants/twig.png');
    for (const p of FENCE_PIECES) for (const c of FENCE_COLORS) this.load.image(`fence_${p}_${c}`, `/assets/fence/${p}_${c}.png`);
    for (const f of FURNITURE) this.load.image(`f_${f.id}`, `/assets/furniture/f_${f.id}.png`);
    for (let i = 0; i < 4; i++) this.load.image(`card_${i}`, `/assets/cards/card_${i}.png`);
    this.load.image('house_ext', '/assets/scenes/house_ext.png');
    this.load.image('home_bg', '/assets/scenes/home_bg.png');
    this.load.image('soil', '/assets/scenes/soil.png');
    this.load.image('flower', '/assets/scenes/flower.png');
    this.load.image('decor_tree_emerald', '/assets/scenes/decor_tree_emerald.png');
    this.load.image('decor_tree_lime', '/assets/scenes/decor_tree_lime.png');
  }
  create() {
    for (let i = 0; i < CHARACTERS; i++) {
      const f = (a: number, b: number) => this.anims.generateFrameNumbers(`char_${i}`, { start: a, end: b });
      this.anims.create({ key: `idle_down_${i}`, frames: f(0, 1), frameRate: 2, repeat: -1 });
      this.anims.create({ key: `walk_down_${i}`, frames: f(2, 3), frameRate: 6, repeat: -1 });
      this.anims.create({ key: `idle_up_${i}`, frames: f(4, 5), frameRate: 2, repeat: -1 });
      this.anims.create({ key: `walk_up_${i}`, frames: f(6, 7), frameRate: 6, repeat: -1 });
      this.anims.create({ key: `idle_side_${i}`, frames: f(8, 9), frameRate: 2, repeat: -1 });
      this.anims.create({ key: `walk_side_${i}`, frames: f(10, 11), frameRate: 6, repeat: -1 });
    }
    this.scene.start('House', { spawn: 'center', ownerId: me().user.id });
  }
}

export async function startGame() {
  document.getElementById('game')!.style.display = 'block';
  mountNavbar();
  const u = me().user;
  setSfx(!!u.sfx); setVolume(u.music_volume); setTrack(u.music_track);
  const kick = () => { unlock(); if (u.music) music(true); window.removeEventListener('pointerdown', kick); window.removeEventListener('keydown', kick); };
  window.addEventListener('pointerdown', kick); window.addEventListener('keydown', kick);
  connectHub();
  on('friends', refreshFriendsIfOpen);
  bus.addEventListener('knock', ((ev: CustomEvent<KnockEvent>) => {
    const { id, name, character } = ev.detail;
    knockPrompt(name, character, (accept) => {
      if (domainNet()) domainNet()!.visit(id, accept);
      else hubVisit(id, accept);
    });
  }) as EventListener);
  if (game) return;
  game = new Phaser.Game({
    type: Phaser.AUTO, parent: 'game', width: W, height: H, pixelArt: true, backgroundColor: '#0b0f0a',
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    physics: { default: 'arcade', arcade: { debug: false } },
    scene: [Boot, HouseScene, GardenScene],
  });
  // The toolbar can wrap independently of a window resize (for example on scene changes).
  const navbar = document.getElementById('navbar')!;
  const layoutObserver = new ResizeObserver(() => {
    document.documentElement.style.setProperty('--nav-height', `${navbar.getBoundingClientRect().height}px`);
    game?.scale.refresh();
  });
  layoutObserver.observe(navbar);
  layoutObserver.observe(document.getElementById('game')!);
  game.events.once(Phaser.Core.Events.DESTROY, () => layoutObserver.disconnect());
  (window as any).__game = game; (window as any).__refresh = refreshMe; // debugging hooks for the e2e scripts
  setInterval(() => refreshMe().catch(() => {}), 60_000);
  on('me', () => { const s = game?.scene.getScenes(true)[0] as any; s?.onMe?.(); });
  if (!u.tutorial_done) setTimeout(tutorial, 1200);
}

/** Switch scene from UI code (map teleport, exits). A focus session or a frozen garden blocks going to your own garden. */
export async function goto(scene: 'House' | 'Garden', data: Record<string, unknown> = {}) {
  const active = game?.scene.getScenes(true)[0];
  if (!active) return;
  if (scene === 'Garden' && data.ownerId === me().user.id && isPomodoroActive()) {
    toast(POMODORO_LOCK_MSG, 'err');
    return;
  }
  if (scene === 'Garden' && data.ownerId === me().user.id && me().user.frozen) {
    const ok = await confirmDialog('Your farm is frozen', 'You cannot go to your farm when it is frozen. Would you like to unfreeze your farm?', 'Unfreeze', 'Stay inside');
    if (!ok) return;
    try { await api.post('/api/me/freeze', { on: false }); await refreshMe(); toast('Garden unfrozen'); } catch (e) { toast((e as Error).message, 'err'); return; }
  }
  const destOwner = typeof data.ownerId === 'number' ? data.ownerId : me().user.id;
  const cur = domainOwnerId();
  if (cur != null && cur !== destOwner) detachDomain(cur);
  active.scene.start(scene, data);
}
export function activeScene() { return game?.scene.getScenes(true)[0] as (Phaser.Scene & { startPlacing?: (id: number) => void }) | undefined; }
