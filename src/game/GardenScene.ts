import Phaser from 'phaser';
import { Player, makeKeys, readInput, typingInDom, type Dir } from './Player';
import { Net, type PeerState } from './net';
import { api } from '../api';
import { me, level, toast, refreshMe } from '../state';
import { isPanelOpen, isPomodoroActive, plotDialog, setHint, knockPrompt, waitingOverlay, gardenHud, hideGardenHud } from '../ui/panels';
import { TILE, gardenTiles, plantById, WITHER_MAX, effectiveSeason, type GardenSeason, type Plot, type GardenView } from '../shared/rules';
import { T, W, H, TT, layerFrom, tile, solidRect } from './tiles';


const MARGIN = 4;          // grass tiles around the fence
const HOUSE_W = 7, HOUSE_H = 4;

/**
 * Procedural garden on Kenney Tiny Town tiles. Grows with level: an N x N fenced grid, the whole house above it,
 * trees and props in the margin. Own garden: E on a tile to buy / plant / feed. Friends: walk, wave, chat.
 */
export class GardenScene extends Phaser.Scene {
  player!: Player;
  keys!: Record<string, Phaser.Input.Keyboard.Key>;
  ownerId = 0;
  view!: GardenView;
  private n = 12;
  private cols = 0; private rows = 0;
  private ox = 0; private oy = 0;               // world px of tile (0,0)
  private gc0 = 0; private gr0 = 0;             // garden interior origin (tile coords)
  private plotLayer!: Phaser.GameObjects.Container;
  private highlight!: Phaser.GameObjects.Rectangle;
  private freeze?: Phaser.GameObjects.Container;
  private net?: Net;
  private peers = new Map<number, Player>();
  private timerTexts: Phaser.GameObjects.Text[] = [];
  private exiting = false;
  private ready = false;
  private doorX = 0; private doorY = 0;
  private chatEl?: HTMLDivElement;
  private shownSeason?: GardenSeason;
  constructor() { super('Garden'); }

  async create(data: { ownerId: number; spawn?: 'gate' | 'porch' }) {
    this.teardown(); this.ready = false; this.exiting = false;
    this.ownerId = data.ownerId;
    const own = this.ownerId === me().user.id;
    this.view = own
      ? { owner: { id: me().user.id, username: me().user.username, character: me().user.character, level: level().level, wither: me().user.wither, frozen: me().user.frozen, season: me().user.season }, plots: me().plots }
      : await api.get<GardenView>(`/api/garden/${this.ownerId}`).catch((e) => { toast(e.message, 'err'); return null as any; });
    if (!this.view) return this.scene.start('House', { spawn: 'center' });

    // ---- layout in tiles ----
    this.n = gardenTiles(this.view.owner.level);
    this.cols = this.n + 2 * MARGIN; this.rows = 1 + HOUSE_H + 2 + this.n + 2 + MARGIN;
    const worldW = Math.max(W, this.cols * T), worldH = Math.max(H, this.rows * T);
    this.ox = Math.round((worldW - this.cols * T) / 2); this.oy = Math.round((worldH - this.rows * T) / 2);
    this.physics.world.setBounds(0, 0, worldW, worldH);
    this.cameras.main.setBounds(0, 0, worldW, worldH);
    const cx = Math.floor(this.cols / 2);           // door column
    const houseC0 = cx - Math.floor(HOUSE_W / 2), houseR0 = 1;
    const fenceR0 = houseR0 + HOUSE_H + 2, fenceR1 = fenceR0 + this.n + 1;   // fence rows (top, bottom)
    const fenceC0 = MARGIN - 1, fenceC1 = MARGIN + this.n;                     // fence cols (left, right)
    this.gc0 = MARGIN; this.gr0 = fenceR0 + 1;
    const rnd = new Phaser.Math.RandomDataGenerator([String(this.ownerId)]);

    // ---- ground layer ----
    const g: number[][] = [];
    for (let r = 0; r < this.rows; r++) {
      const row: number[] = [];
      for (let c = 0; c < this.cols; c++) row.push(rnd.frac() < 0.06 ? TT.grassFlower : TT.grass[rnd.between(0, 1)]);
      g.push(row);
    }
    // path from the door down through the gate
    for (let r = houseR0 + HOUSE_H; r <= fenceR0 + 1; r++) g[r][cx] = TT.path[0];
    // fence
    for (let c = fenceC0; c <= fenceC1; c++) { g[fenceR0][c] = TT.fence.t; g[fenceR1][c] = TT.fence.b; }
    for (let r = fenceR0; r <= fenceR1; r++) { g[r][fenceC0] = TT.fence.l; g[r][fenceC1] = TT.fence.r; }
    g[fenceR0][fenceC0] = TT.fence.tl; g[fenceR0][fenceC1] = TT.fence.tr; g[fenceR1][fenceC0] = TT.fence.bl; g[fenceR1][fenceC1] = TT.fence.br;
    g[fenceR0][cx] = TT.path[0]; g[fenceR0][cx - 1] = TT.fence.post; g[fenceR0][cx + 1] = TT.fence.post; // gate
    // house: roof rows then wall rows
    for (let i = 0; i < HOUSE_W; i++) {
      g[houseR0][houseC0 + i] = i === 0 ? TT.roof.l : i === HOUSE_W - 1 ? TT.roof.r : TT.roof.m;
      g[houseR0 + 1][houseC0 + i] = i === 0 ? TT.roof.l2 : i === HOUSE_W - 1 ? TT.roof.r2 : TT.roof.m2;
      g[houseR0 + 2][houseC0 + i] = i === 0 ? TT.wall.l : i === HOUSE_W - 1 ? TT.wall.r : i === 1 || i === HOUSE_W - 2 ? TT.wall.window : TT.wall.m;
      g[houseR0 + 3][houseC0 + i] = i === 0 ? TT.wall.l : i === HOUSE_W - 1 ? TT.wall.r : houseC0 + i === cx ? TT.wall.door : TT.wall.m;
    }
    g[houseR0][houseC0 + 1] = TT.chimney;
    layerFrom(this, 'tinytown_img', g, this.ox, this.oy, -10);
    this.add.rectangle(0, 0, worldW, worldH, 0x1e2f1a).setOrigin(0).setDepth(-20);
    this.doorX = this.ox + (cx + 0.5) * T; this.doorY = this.oy + (houseR0 + HOUSE_H) * T;

    // ---- colliders ----
    const walls = this.physics.add.staticGroup();
    const solid = (c1: number, r1: number, c2: number, r2: number) => solidRect(this, walls, this.ox + c1 * T, this.oy + r1 * T, (c2 - c1) * T, (r2 - r1) * T);
    solid(houseC0, houseR0, cx, houseR0 + HOUSE_H - 0.15); solid(cx + 1, houseR0, houseC0 + HOUSE_W, houseR0 + HOUSE_H - 0.15); solid(houseC0, houseR0, houseC0 + HOUSE_W, houseR0 + HOUSE_H - 1);
    solid(fenceC0, fenceR0 + 0.3, cx - 0.9, fenceR0 + 0.8); solid(cx + 1.9, fenceR0 + 0.3, fenceC1 + 1, fenceR0 + 0.8);
    solid(fenceC0, fenceR1 + 0.3, fenceC1 + 1, fenceR1 + 0.8);
    solid(fenceC0 + 0.3, fenceR0, fenceC0 + 0.7, fenceR1 + 1); solid(fenceC1 + 0.3, fenceR0, fenceC1 + 0.7, fenceR1 + 1);

    // ---- props in the margin (deterministic per owner) ----
    const prop = (frame: number, c: number, r: number, solidW = 0) => {
      const im = tile(this, 'tinytown', frame, this.ox + (c + 0.5) * T, this.oy + (r + 1) * T);
      if (solidW) solidRect(this, walls, im.x - solidW / 2, im.y - 18, solidW, 18);
      return im;
    };
    const taken = new Set<string>();
    const free = (c: number, r: number) => !taken.has(`${c},${r}`) && !(r >= houseR0 - 1 && r <= houseR0 + HOUSE_H && c >= houseC0 - 1 && c <= houseC0 + HOUSE_W) && !(r >= fenceR0 - 1 && r <= fenceR1 + 1 && c >= fenceC0 - 1 && c <= fenceC1 + 1) && !(c === cx && r <= fenceR0);
    for (let i = 0; i < this.cols * this.rows * 0.05; i++) {
      const c = rnd.between(1, this.cols - 2), r = rnd.between(1, this.rows - 2);
      if (!free(c, r)) continue;
      taken.add(`${c},${r}`);
      const k = rnd.frac();
      if (k < 0.55) prop(TT.trees[rnd.between(0, TT.trees.length - 1)], c, r, 30); else if (k < 0.8) prop(TT.bush, c, r, 30); else if (k < 0.9) prop(TT.mushroom, c, r); else prop(TT.rock, c, r);
    }
    prop(TT.crate, houseC0 - 1, houseR0 + HOUSE_H - 1, 40); prop(TT.barrel, houseC0 + HOUSE_W, houseR0 + HOUSE_H - 1, 40);
    prop(TT.beehive, houseC0 + HOUSE_W + 1, houseR0 + HOUSE_H, 40); prop(TT.sign, cx + 2, fenceR0 - 1);
    prop(TT.pot, cx - 2, houseR0 + HOUSE_H); prop(TT.hay, houseC0 - 2, houseR0 + HOUSE_H, 40);
    for (let i = 0; i < 8; i++) { const c = rnd.between(fenceC0 + 1, fenceC1 - 1), r = rnd.between(this.gr0, fenceR1 - 1); if (rnd.frac() < 0.5) this.add.image(this.ox + (c + rnd.frac()) * T, this.oy + (r + rnd.frac()) * T, 'flower').setDepth(-9); }
    this.applySeason(effectiveSeason(this.view.owner.season, new Date().getMonth()));

    // ---- plots + player ----
    this.plotLayer = this.add.container(0, 0);
    this.highlight = this.add.rectangle(0, 0, T, T).setStrokeStyle(3, 0xf0ebcc, 0.9).setFillStyle(0xffffff, 0.08).setDepth(5).setVisible(false);
    this.drawPlots();
    const spawn = data.spawn === 'porch' ? [this.doorX, this.doorY + 40] : [this.doorX, this.oy + (this.gr0 + 0.8) * T];
    this.player = new Player(this, spawn[0], spawn[1], me().user.character ?? 0, me().user.username, true);
    this.player.setCollideWorldBounds(true);
    this.physics.add.collider(this.player, walls);
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);
    this.keys = makeKeys(this);
    const guarded = (fn: () => void) => () => { if (!isPanelOpen() && !isPomodoroActive() && !typingInDom() && !this.chatEl) fn(); };
    if (own) this.input.keyboard!.on('keydown-E', guarded(() => this.interact()));
    this.input.keyboard!.on('keydown-F', guarded(() => { this.player.emote('wave'); this.net?.emote('wave'); }));
    this.input.keyboard!.on('keydown-ENTER', guarded(() => this.openChat()));
    this.events.once('shutdown', () => this.teardown());
    this.connect(own);
    if (own) gardenHud(this.n);
    setHint(own ? 'E on a tile: dig / plant / feed · Enter chat · F wave · Shift run · walk into the door to go inside' : `Visiting ${this.view.owner.username}'s garden · Enter chat · F wave · door = go home`);
    this.ready = true;
  }

  onMe() {
    if (!this.ready || this.ownerId !== me().user.id) return;
    if (gardenTiles(level().level) !== this.n) { this.scene.restart({ ownerId: this.ownerId, spawn: 'gate' }); return; } // levelled up: the fence moves out
    const nextSeason = effectiveSeason(me().user.season, new Date().getMonth());
    if (nextSeason !== this.shownSeason) { this.scene.restart({ ownerId: this.ownerId, spawn: 'gate' }); return; }
    this.view.plots = me().plots; this.view.owner.wither = me().user.wither; this.view.owner.frozen = me().user.frozen; this.view.owner.season = me().user.season;
    this.drawPlots(); gardenHud(this.n);
  }

  private tileAt(x: number, y: number): [number, number] | null {
    const tx = Math.floor((x - this.ox) / T) - this.gc0, ty = Math.floor((y - 6 - this.oy) / T) - this.gr0;
    return tx >= 0 && ty >= 0 && tx < this.n && ty < this.n ? [tx, ty] : null;
  }
  private interact() {
    const t = this.tileAt(this.player.x, this.player.y);
    if (!t) return;
    const plot = this.view.plots.find((p) => p.tx === t[0] && p.ty === t[1]);
    plotDialog(t[0], t[1], plot ?? null);
  }

  /** Tilled tiles, crop sprites by stage (mature = the plant's own art), wither tint, growth timers, frozen overlay. */
  drawPlots() {
    this.plotLayer.removeAll(true); this.timerTexts = [];
    const wither = this.view.owner.wither / WITHER_MAX;
    const tint = Phaser.Display.Color.Interpolate.ColorWithColor(new Phaser.Display.Color(255, 255, 255), new Phaser.Display.Color(120, 115, 105), 1, wither);
    const tintHex = Phaser.Display.Color.GetColor(tint.r, tint.g, tint.b);
    for (const p of this.view.plots) {
      const x = this.ox + (this.gc0 + p.tx) * T, y = this.oy + (this.gr0 + p.ty) * T;
      this.plotLayer.add(this.add.image(x, y, 'tinytown', TT.dirt).setOrigin(0).setScale(4).setDepth(-5));
      if (!p.plant_id) continue;
      const plant = plantById(p.plant_id)!;
      const cx = x + T / 2, by = y + T - 4;
      const im = this.add.image(cx, by, `plant_${plant.sprite}`).setOrigin(0.5, 1).setScale([0.34, 0.54, 0.76, 1][Math.min(3, p.stage)]);
      im.setDepth(by).setTint(tintHex).setAlpha(1 - wither * 0.3);
      this.plotLayer.add(im);
      if (p.ready_at) {
        const t = this.add.text(cx, y - 2, '', { fontFamily: 'VT323', fontSize: '18px', color: '#F0EBCC', backgroundColor: '#103523', padding: { x: 5, y: 1 } }).setOrigin(0.5, 1).setDepth(1000);
        (t as any).readyAt = p.ready_at; this.timerTexts.push(t); this.plotLayer.add(t);
      }
    }
    this.freeze?.destroy(); this.freeze = undefined;
    if (this.view.owner.frozen) {
      const gx = this.ox + this.gc0 * T, gy = this.oy + this.gr0 * T, s = this.n * T;
      const r = this.add.rectangle(gx + s / 2, gy + s / 2, s, s, 0x9fd8ff, 0.35).setDepth(900);
      const t = this.add.text(gx + s / 2, gy + 10, '❄ FROZEN ❄', { fontFamily: 'Pixelify Sans', fontSize: '28px', color: '#e8f6ff', stroke: '#2a5a8a', strokeThickness: 5 }).setOrigin(0.5, 0).setDepth(901);
      this.freeze = this.add.container(0, 0, [r, t]);
    }
  }

  /** A light screen tint is the full season effect. It does not add or replace art assets. */
  private applySeason(season: GardenSeason) {
    this.shownSeason = season;
    if (season === 'summer') return;
    const style = {
      rainy: { color: 0x365f83, alpha: 0.12 },
      fall: { color: 0xa83d2f, alpha: 0.14 },
      winter: { color: 0xdce3e5, alpha: 0.18 },
    }[season];
    const overlay = this.add.rectangle(W / 2, H / 2, W, H, style.color, style.alpha).setScrollFactor(0).setDepth(1_000_000).setAlpha(0).setName(`season-${season}`);
    this.tweens.add({ targets: overlay, alpha: 1, duration: 300 });
  }

  // ---------- realtime ----------
  private connect(own: boolean) {
    const goHome = () => { if (!this.exiting) { this.exiting = true; this.scene.start('House', { spawn: 'friends' }); } };
    this.net = new Net(this.ownerId, {
      roster: (_you, peers) => { waitingOverlay(null); peers.forEach((p) => this.addPeer(p)); },
      join: (p) => { this.addPeer(p); if (own) toast(`${p.name} came to visit`); },
      leave: (id) => { this.peers.get(id)?.destroy(); this.peers.delete(id); },
      move: (m) => { const p = this.peers.get(m.id); if (!p) return; (p as any).target = { x: m.x, y: m.y }; p.setFacing(m.dir as Dir, m.moving); },
      chat: (id, text) => { const p = id === me().user.id ? this.player : this.peers.get(id); if (p) { p.typing = false; p.say(text); } },
      typing: (id, on) => { const p = this.peers.get(id); if (!p) return; if (on) { p.say('. . .', 0); p.typing = true; } else if (p.typing) { p.typing = false; p.clearBubble(); } },
      emote: (id, kind) => this.peers.get(id)?.emote(kind),
      knocking: () => waitingOverlay(this.view.owner.username, () => { this.net?.close(); goHome(); }),
      knock: (p) => knockPrompt(p.name, p.character, (accept) => this.net?.visit(p.id, accept)),
      denied: () => { waitingOverlay(null); toast(`${this.view.owner.username} is busy right now`, 'err'); goHome(); },
    });
  }
  private addPeer(p: PeerState) {
    if (p.id === me().user.id || this.peers.has(p.id)) return;
    const pl = new Player(this, p.x || this.doorX, p.y || this.oy + (this.gr0 + 1) * T, p.character, p.name, false);
    pl.body!.enable = false;
    (pl as any).target = { x: p.x || pl.x, y: p.y || pl.y };
    pl.setFacing(p.dir as Dir, p.moving);
    this.peers.set(p.id, pl);
  }
  private openChat() {
    if (this.chatEl) return;
    const el = document.createElement('div'); el.id = 'chat';
    const input = document.createElement('input'); input.maxLength = 140; input.placeholder = 'Say something... (Enter to send, Esc to cancel)';
    el.appendChild(input); document.getElementById('overlay')!.appendChild(el);
    this.chatEl = el;
    let typing = false, sent = false;
    input.addEventListener('input', () => { const on = input.value.length > 0; if (on !== typing) { typing = on; this.net?.typing(on); } });
    const close = () => { if (this.chatEl !== el) return; if (typing && !sent) this.net?.typing(false); el.remove(); this.chatEl = undefined; };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') close();
      if (e.key === 'Enter') { const text = input.value.trim(); if (text) { sent = true; this.net?.chat(text); this.player.say(text); } close(); }
    });
    input.addEventListener('blur', () => setTimeout(close, 100)); // clicking the canvas closes the box instead of trapping the keyboard
    setTimeout(() => input.focus(), 0);
  }
  private teardown() {
    this.net?.close(); this.net = undefined;
    this.peers.forEach((p) => p.destroy()); this.peers.clear();
    this.chatEl?.remove(); this.chatEl = undefined;
    waitingOverlay(null); hideGardenHud();
  }

  update(_t: number, dt: number) {
    if (!this.ready || this.exiting || !this.player.body) return;
    const focusLocked = this.ownerId === me().user.id && isPomodoroActive();
    const [vx, vy, run] = isPanelOpen() || focusLocked || typingInDom() || this.chatEl ? [0, 0, false] : readInput(this.keys);
    this.player.drive(vx, vy, run, dt);
    this.net?.move(this.player.x, this.player.y, this.player.dir, this.player.moving);
    for (const p of this.peers.values()) { const t = (p as any).target; if (t) { p.x += (t.x - p.x) * 0.25; p.y += (t.y - p.y) * 0.25; } }
    const now = Date.now();
    for (const t of this.timerTexts) { const ms = (t as any).readyAt - now; t.setText(ms <= 0 ? 'ready!' : fmt(ms)); if (ms <= 0 && !(t as any).refreshed) { (t as any).refreshed = true; refreshMe().catch(() => {}); } }
    const own = this.ownerId === me().user.id;
    const tileHere = own && !focusLocked ? this.tileAt(this.player.x, this.player.y) : null;
    this.highlight.setVisible(!!tileHere);
    if (tileHere) this.highlight.setPosition(this.ox + (this.gc0 + tileHere[0] + 0.5) * T, this.oy + (this.gr0 + tileHere[1] + 0.5) * T);
    if (Math.abs(this.player.x - this.doorX) < 36 && this.player.y < this.doorY + 14 && this.player.dir === 'up') {
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
export { TILE };
