import Phaser from 'phaser';
import { Player, makeKeys, readInput, type Dir } from './Player';
import { Net, type PeerState } from './net';
import { api } from '../api';
import { me, level, toast, refreshMe } from '../state';
import { isPanelOpen, plotDialog, setHint } from '../ui/panels';
import { TILE, gardenTiles, plantById, WITHER_MAX, type Plot, type GardenView } from '../shared/rules';
import { W, H } from './index';

const MARGIN = 3;
const STAGE_SCALE = [0, 0.4, 0.7, 1];

/**
 * Procedural garden. Grows with level: an N x N fenced grid of tiles, house facade above it, decor outside the fence.
 * Own garden: buy plots / plant / feed with E. Friend garden: walk + chat only. Both are realtime rooms.
 */
export class GardenScene extends Phaser.Scene {
  player!: Player;
  keys!: Record<string, Phaser.Input.Keyboard.Key>;
  ownerId = 0;
  view!: GardenView;
  private n = 8;
  private gx = 0; private gy = 0; // garden top-left in world px
  private plotLayer!: Phaser.GameObjects.Container;
  private highlight!: Phaser.GameObjects.Rectangle;
  private freeze?: Phaser.GameObjects.Container;
  private net?: Net;
  private peers = new Map<number, Player>();
  private timerTexts: Phaser.GameObjects.Text[] = [];
  private exiting = false;
  private doorX = 0; private doorY = 0;
  private chatEl?: HTMLDivElement;
  constructor() { super('Garden'); }

  async create(data: { ownerId: number; spawn?: 'gate' | 'porch' }) {
    this.exiting = false;
    this.ownerId = data.ownerId;
    const own = this.ownerId === me().user.id;
    this.view = own
      ? { owner: { id: me().user.id, username: me().user.username, character: me().user.character, level: level().level, wither: me().user.wither, frozen: me().user.frozen }, plots: me().plots }
      : await api.get<GardenView>(`/api/garden/${this.ownerId}`).catch((e) => { toast(e.message, 'err'); return null as any; });
    if (!this.view) return this.scene.start('House', { spawn: 'center' });

    this.n = gardenTiles(this.view.owner.level);
    const worldW = Math.max(W, (this.n + 2 * MARGIN) * TILE);
    const facadeH = 290, facadeY = 24;
    this.gy = facadeY + facadeH + 30;
    this.gx = Math.round((worldW - this.n * TILE) / 2);
    const worldH = Math.max(H, this.gy + this.n * TILE + MARGIN * TILE);
    this.physics.world.setBounds(0, 0, worldW, worldH);
    this.cameras.main.setBounds(0, 0, worldW, worldH);

    // ground
    this.add.tileSprite(0, 0, worldW, worldH, 'tile_grass').setOrigin(0).setDepth(-10);
    const rnd = new Phaser.Math.RandomDataGenerator([String(this.ownerId)]);
    for (let i = 0; i < (worldW * worldH) / 45000; i++) this.add.image(rnd.between(0, worldW), rnd.between(0, worldH), 'flower').setDepth(-9);
    const cx = worldW / 2;
    this.add.image(cx, facadeY, 'house_facade').setOrigin(0.5, 0).setDepth(facadeY + facadeH - 40);
    this.doorX = cx; this.doorY = facadeY + facadeH;
    // path from porch to gate and into the garden
    this.add.tileSprite(cx, facadeY + facadeH - 10, TILE * 1.5, this.gy - (facadeY + facadeH) + 10 + TILE * 2, 'tile_path').setOrigin(0.5, 0).setDepth(-8);

    // fence with a gate gap at the top center
    const walls = this.physics.add.staticGroup();
    const solid = (x: number, y: number, w: number, h: number) => { const r = this.add.rectangle(x + w / 2, y + h / 2, w, h); this.physics.add.existing(r, true); walls.add(r); };
    const gw = this.n * TILE, gh = this.n * TILE, gapHalf = TILE * 0.9;
    const fence = (x: number, y: number, w: number, h: number, key: 'fence_h' | 'fence_v') => this.add.tileSprite(x, y, w, h, key).setOrigin(0).setDepth(y + h - 6);
    fence(this.gx - 12, this.gy - 40, cx - gapHalf - (this.gx - 12), 44, 'fence_h'); fence(cx + gapHalf, this.gy - 40, this.gx + gw + 12 - (cx + gapHalf), 44, 'fence_h');
    fence(this.gx - 12, this.gy + gh - 20, gw + 24, 44, 'fence_h');
    fence(this.gx - 24, this.gy - 30, 34, gh + 40, 'fence_v'); fence(this.gx + gw - 10, this.gy - 30, 34, gh + 40, 'fence_v');
    solid(this.gx - 24, this.gy - 24, cx - gapHalf - (this.gx - 24), 20); solid(cx + gapHalf, this.gy - 24, this.gx + gw + 24 - (cx + gapHalf), 20);
    solid(this.gx - 24, this.gy + gh, gw + 48, 20); solid(this.gx - 24, this.gy - 24, 20, gh + 44); solid(this.gx + gw + 4, this.gy - 24, 20, gh + 44);
    // house facade is solid except the door
    solid(cx - 280, facadeY, 250, facadeH - 30); solid(cx + 30, facadeY, 250, facadeH - 30); solid(cx - 280, facadeY, 560, facadeH - 90);

    // decor outside the fence (deterministic per owner)
    const decor = (key: string, x: number, y: number, solidBox?: [number, number]) => { const im = this.add.image(x, y, key).setOrigin(0.5, 1).setDepth(y); if (solidBox) solid(x - solidBox[0] / 2, y - solidBox[1], solidBox[0], solidBox[1]); return im; };
    decor('tree_big', this.gx - 110, this.gy + 200, [70, 60]); decor('tree_big', this.gx + gw + 110, this.gy + gh - 40, [70, 60]);
    decor('bush_round', this.gx - 80, this.gy + gh + 60); decor('bush_round', this.gx + gw + 90, this.gy + 40);
    decor('barrel', cx - 200, facadeY + facadeH + 20, [40, 30]); decor('barrel2', cx + 210, facadeY + facadeH + 10, [40, 30]);
    decor('mailbox', cx + 150, facadeY + facadeH + 60, [24, 24]); decor('bench', this.gx - 130, facadeY + facadeH - 20, [100, 30]);
    decor('chest', this.gx + gw + 150, facadeY + facadeH + 40, [110, 40]);
    for (let i = 0; i < 4; i++) decor(i % 2 ? 'bush_round' : 'tree_big', rnd.between(60, worldW - 60), worldH - rnd.between(20, 60));

    // plots + player
    this.plotLayer = this.add.container(0, 0);
    this.highlight = this.add.rectangle(0, 0, TILE, TILE).setStrokeStyle(3, 0xf0ebcc, 0.9).setFillStyle(0xffffff, 0.08).setDepth(5).setVisible(false);
    this.drawPlots();
    const spawn = data.spawn === 'porch' ? [cx, facadeY + facadeH + 30] : [cx, this.gy + TILE];
    this.player = new Player(this, spawn[0], spawn[1], me().user.character ?? 0, me().user.username, true);
    this.player.setCollideWorldBounds(true);
    this.physics.add.collider(this.player, walls);
    this.cameras.main.startFollow(this.player, true, 0.15, 0.15);
    this.keys = makeKeys(this);
    if (own) this.input.keyboard!.on('keydown-E', () => this.interact());
    this.input.keyboard!.on('keydown-ENTER', () => this.openChat());
    this.events.once('shutdown', () => this.teardown());
    this.connect();
    setHint(own ? 'E on a tile to buy a plot / plant / feed · Enter to chat · walk to the door to go inside' : `Visiting ${this.view.owner.username}'s garden · Enter to chat · walk to the door to go home`);
  }

  onMe() {
    if (this.ownerId !== me().user.id) return;
    if (gardenTiles(level().level) !== this.n) { this.scene.restart({ ownerId: this.ownerId, spawn: 'gate' }); return; } // levelled up: the fence moves out
    this.view.plots = me().plots; this.view.owner.wither = me().user.wither; this.view.owner.frozen = me().user.frozen;
    this.drawPlots();
  }

  private tileAt(x: number, y: number): [number, number] | null {
    const tx = Math.floor((x - this.gx) / TILE), ty = Math.floor((y - 8 - this.gy) / TILE);
    return tx >= 0 && ty >= 0 && tx < this.n && ty < this.n ? [tx, ty] : null;
  }
  private interact() {
    if (isPanelOpen()) return;
    const t = this.tileAt(this.player.x, this.player.y);
    if (!t) return;
    const plot = this.view.plots.find((p) => p.tx === t[0] && p.ty === t[1]);
    plotDialog(t[0], t[1], plot ?? null);
  }

  /** Dirt tiles, plant sprites scaled by stage, wither tint, growth timers, frozen overlay. */
  drawPlots() {
    this.plotLayer.removeAll(true); this.timerTexts = [];
    const wither = this.view.owner.wither / WITHER_MAX;
    const tint = Phaser.Display.Color.Interpolate.ColorWithColor(new Phaser.Display.Color(255, 255, 255), new Phaser.Display.Color(110, 110, 100), 1, wither);
    const tintHex = Phaser.Display.Color.GetColor(tint.r, tint.g, tint.b);
    for (const p of this.view.plots) {
      const x = this.gx + p.tx * TILE, y = this.gy + p.ty * TILE;
      this.plotLayer.add(this.add.image(x, y, 'tile_dirt').setOrigin(0).setDepth(-5));
      if (!p.plant_id) continue;
      const plant = plantById(p.plant_id)!;
      const cx = x + TILE / 2, by = y + TILE - 6;
      if (p.stage === 0) {
        this.plotLayer.add(this.add.ellipse(cx, by - 6, 30, 14, 0x5a3f2a).setDepth(by));
        this.plotLayer.add(this.add.ellipse(cx, by - 9, 8, 10, 0x8fbf5a).setDepth(by + 1));
      } else {
        this.plotLayer.add(this.add.image(cx, by, `plant_${plant.sprite}`).setOrigin(0.5, 1).setScale(STAGE_SCALE[p.stage]).setDepth(by).setTint(tintHex).setAlpha(1 - wither * 0.3));
      }
      if (p.ready_at) {
        const t = this.add.text(cx, y - 4, '', { fontFamily: 'Pixelify Sans', fontSize: '13px', color: '#F0EBCC', backgroundColor: '#103523', padding: { x: 4, y: 1 } }).setOrigin(0.5, 1).setDepth(1000);
        (t as any).readyAt = p.ready_at; this.timerTexts.push(t); this.plotLayer.add(t);
      }
    }
    this.freeze?.destroy(); this.freeze = undefined;
    if (this.view.owner.frozen) {
      const r = this.add.rectangle(this.gx + this.n * TILE / 2, this.gy + this.n * TILE / 2, this.n * TILE, this.n * TILE, 0x9fd8ff, 0.35).setDepth(900);
      const t = this.add.text(this.gx + this.n * TILE / 2, this.gy + 10, '❄ FROZEN ❄', { fontFamily: 'Pixelify Sans', fontSize: '26px', color: '#e8f6ff', stroke: '#2a5a8a', strokeThickness: 5 }).setOrigin(0.5, 0).setDepth(901);
      this.freeze = this.add.container(0, 0, [r, t]);
    }
  }

  // ---------- realtime ----------
  private connect() {
    this.net = new Net(this.ownerId, {
      roster: (_you, peers) => peers.forEach((p) => this.addPeer(p)),
      join: (p) => this.addPeer(p),
      leave: (id) => { this.peers.get(id)?.destroy(); this.peers.delete(id); },
      move: (m) => { const p = this.peers.get(m.id); if (!p) return; (p as any).target = { x: m.x, y: m.y }; p.setFacing(m.dir as Dir, m.moving); },
      chat: (id, text) => { const p = id === me().user.id ? this.player : this.peers.get(id); if (p) { p.typing = false; p.say(text); } },
      typing: (id, on) => { const p = this.peers.get(id); if (!p) return; if (on) { p.say('. . .', 0); p.typing = true; } else if (p.typing) { p.typing = false; p.clearBubble(); } },
    });
  }
  private addPeer(p: PeerState) {
    if (p.id === me().user.id || this.peers.has(p.id)) return;
    const pl = new Player(this, p.x || this.doorX, p.y || this.gy + TILE, p.character, p.name, false);
    pl.body!.enable = false;
    (pl as any).target = { x: p.x || pl.x, y: p.y || pl.y };
    pl.setFacing(p.dir as Dir, p.moving);
    this.peers.set(p.id, pl);
  }
  private openChat() {
    if (isPanelOpen() || this.chatEl) return;
    const el = document.createElement('div'); el.id = 'chat';
    el.innerHTML = '<input maxlength="140" placeholder="Say something... (Enter to send, Esc to cancel)" />';
    document.getElementById('overlay')!.appendChild(el);
    const input = el.querySelector('input')!; this.chatEl = el;
    let typing = false;
    input.addEventListener('input', () => { const on = input.value.length > 0; if (on !== typing) { typing = on; this.net?.typing(on); } });
    const close = () => { if (typing) this.net?.typing(false); el.remove(); this.chatEl = undefined; this.input.keyboard!.enabled = true; };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') close();
      if (e.key === 'Enter') { const text = input.value.trim(); if (text) { this.net?.chat(text); this.player.say(text); } close(); }
    });
    this.input.keyboard!.enabled = false;
    setTimeout(() => input.focus(), 0);
  }
  private teardown() {
    this.net?.close(); this.net = undefined;
    this.peers.forEach((p) => p.destroy()); this.peers.clear();
    this.chatEl?.remove(); this.chatEl = undefined;
    this.input.keyboard!.enabled = true;
  }

  update(_t: number, dt: number) {
    if (this.exiting || !this.player) return;
    const [vx, vy] = isPanelOpen() || this.chatEl ? [0, 0] : readInput(this.keys);
    this.player.drive(vx, vy, dt);
    this.net?.move(this.player.x, this.player.y, this.player.dir, this.player.moving);
    for (const p of this.peers.values()) { const t = (p as any).target; if (t) { p.x += (t.x - p.x) * 0.25; p.y += (t.y - p.y) * 0.25; } }
    const now = Date.now();
    for (const t of this.timerTexts) { const ms = (t as any).readyAt - now; t.setText(ms <= 0 ? 'ready!' : fmt(ms)); if (ms <= 0 && !(t as any).refreshed) { (t as any).refreshed = true; refreshMe().catch(() => {}); } }
    const own = this.ownerId === me().user.id;
    const tile = own ? this.tileAt(this.player.x, this.player.y) : null;
    this.highlight.setVisible(!!tile);
    if (tile) this.highlight.setPosition(this.gx + tile[0] * TILE + TILE / 2, this.gy + tile[1] * TILE + TILE / 2);
    if (Math.abs(this.player.x - this.doorX) < 40 && this.player.y < this.doorY + 12 && this.player.dir === 'up') {
      this.exiting = true;
      this.cameras.main.fadeOut(250, 11, 15, 10);
      this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('House', { spawn: 'door' }));
    }
  }
}
export function fmt(ms: number) {
  const m = Math.ceil(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}
export type { Plot };
