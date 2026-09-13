import Phaser from 'phaser';
import { Player, makeKeys, readInput, typingInDom, type Dir } from './Player';
import { Net, type PeerState } from './net';
import { attachDomain, detachDomain, domainPeer } from './domainNet';
import { api } from '../api';
import { me, level, toast, refreshMe } from '../state';
import { furnitureMenu, isPanelOpen, isPomodoroActive, plotDialog, setHint, setVisitBadge, waitingOverlay, gardenHud, hideGardenHud, editPalette, hideEditPalette, setNavMode, confirmDialog, type EditTool } from '../ui/panels';
import { furnitureById, furnitureArea, gardenFurnitureFits, type PlacedFurniture, gardenTiles, plantById, plantSprite, plantStage, plantReward, fencePiece, WITHER_MAX, STAGES, effectiveSeason, type GardenSeason, type Plot, type GardenView, type FenceTile } from '../shared/rules';
import { T, W, H, TT, SCALE, layerFrom, solidRect } from './tiles';

const MARGIN = 3;          // grass tiles around the editable garden
const HOUSE_ROWS = 7;      // rows above the garden that the house occupies
const PLANT_H = { flower: 54 * 1.15, tree: 150, twig: 30 };
const PLAYER_SCALE = 0.65; // Fit characters to the garden fences and small outdoor objects.

/**
 * The garden: an N x N editable grid (N from level) below the house, with a grass margin around it.
 * Everything inside the grid is placed by the owner: fences / gates (autotiled), plots (soil) and plants.
 * Own garden: E on a tile = plot dialog, the Edit button = build mode with a palette and mouse placement.
 * Friends' gardens are read-only; both host realtime peers (move / chat / wave) and the knock flow.
 */
export class GardenScene extends Phaser.Scene {
  player!: Player;
  keys!: Record<string, Phaser.Input.Keyboard.Key>;
  ownerId = 0;
  view!: GardenView;
  private n = 12;
  private cols = 0; private rows = 0;
  private ox = 0; private oy = 0;               // world px of tile (0,0)
  private gc0 = 0; private gr0 = 0;             // garden grid origin (tile coords)
  private worldW = 0; private worldH = 0;
  private walls!: Phaser.Physics.Arcade.StaticGroup;
  private plotLayer!: Phaser.GameObjects.Container;
  private fenceLayer!: Phaser.GameObjects.Container;
  private plantSprites: Phaser.GameObjects.Image[] = [];
  private plantBodies: Phaser.GameObjects.GameObject[] = [];
  private fenceBodies: Phaser.GameObjects.GameObject[] = [];
  private gates: { tx: number; ty: number; img: Phaser.GameObjects.Image; open: boolean; vertical: boolean }[] = [];
  private highlight!: Phaser.GameObjects.Rectangle;
  private grid!: Phaser.GameObjects.Graphics;
  private freeze?: Phaser.GameObjects.Container;
  private net?: Net;
  private peers = new Map<number, Player>();
  private exiting = false;
  private ready = false;
  private doorX = 0; private doorY = 0;
  private chatEl?: HTMLDivElement;
  private shownSeason?: GardenSeason;
  private edit: { tool: EditTool; moving: number | null } | null = null;
  private hoverPlot: Plot | null = null;
  private tipEl?: HTMLDivElement;
  private pendingRefresh = false;
  private furnitureSprites: Phaser.GameObjects.Image[] = [];
  private furnitureBodies: Phaser.GameObjects.GameObject[] = [];
  private placing: { furniture_id: number; placedId: number | null } | null = null;
  private ghost?: Phaser.GameObjects.Image;
  private placingBusy = false;
  constructor() { super('Garden'); }

  async create(data: { ownerId: number; spawn?: 'gate' | 'porch' }) {
    this.teardown(); this.ready = false; this.exiting = false; this.edit = null;
    this.ownerId = data.ownerId;
    // Clear any leftover fade from the previous scene so transitions never stick on a black screen.
    this.cameras.main.resetFX();
    this.cameras.main.setAlpha(1);
    this.cameras.main.fadeIn(200, 11, 15, 10);
    const own = this.ownerId === me().user.id;
    this.view = own
      ? { owner: { id: me().user.id, username: me().user.username, character: me().user.character, level: level().level, wither: me().user.wither, frozen: me().user.frozen, season: me().user.season, fence_color: me().user.fence_color, growth: me().user.growth }, plots: me().plots, fences: me().fences, furniture: me().placed.filter(p => p.location === 'garden') }
      : await api.get<GardenView>(`/api/garden/${this.ownerId}`).catch((e) => { toast(e.message, 'err'); return null as any; });
    if (!this.view) { detachDomain(this.ownerId); return this.scene.start('House', { spawn: 'center', ownerId: me().user.id }); }
    this.view.plots = this.view.plots.filter((plot) => !plot.plant_id || plantById(plot.plant_id));

    // ---- layout ----
    this.n = gardenTiles(this.view.owner.level);
    this.cols = this.n + 2 * MARGIN; this.rows = HOUSE_ROWS + this.n + MARGIN;
    this.worldW = Math.max(W, this.cols * T); this.worldH = Math.max(H, this.rows * T);
    this.ox = Math.round((this.worldW - this.cols * T) / 2); this.oy = Math.round((this.worldH - this.rows * T) / 2);
    this.physics.world.setBounds(0, 0, this.worldW, this.worldH);
    this.cameras.main.setBounds(0, 0, this.worldW, this.worldH);
    this.gc0 = MARGIN; this.gr0 = HOUSE_ROWS;
    const cx = this.gc0 + Math.floor(this.n / 2);   // door / path column
    const rnd = new Phaser.Math.RandomDataGenerator([String(this.ownerId)]);

    // ---- ground ----
    const g: number[][] = [];
    for (let r = 0; r < this.rows; r++) {
      const row: number[] = [];
      for (let c = 0; c < this.cols; c++) row.push(rnd.frac() < 0.05 ? TT.grassFlower : TT.grass[rnd.between(0, 1)]);
      g.push(row);
    }
    for (let r = HOUSE_ROWS - 1; r <= this.gr0 + 1; r++) g[r][cx] = TT.path[0];
    layerFrom(this, 'tinytown_img', g, this.ox, this.oy, -10);
    this.add.rectangle(0, 0, this.worldW, this.worldH, 0x1e2f1a).setOrigin(0).setDepth(-20);
    for (let i = 0; i < this.cols * 2; i++) {
      const c = rnd.between(0, this.cols - 1), r = rnd.between(0, this.rows - 1);
      const inGarden = c >= this.gc0 && c < this.gc0 + this.n && r >= this.gr0 && r < this.gr0 + this.n;
      if (!inGarden && r > 1) this.add.image(this.ox + (c + rnd.frac()) * T, this.oy + (r + rnd.frac()) * T, 'flower').setDepth(-9);
    }

    // ---- house (the whole cottage; walk up into the door to go inside) ----
    this.doorX = this.ox + (cx + 0.5) * T; this.doorY = this.oy + HOUSE_ROWS * T - 6;
    const house = this.add.image(this.doorX, this.doorY, 'house_ext').setOrigin(0.5, 1);
    house.setDepth(this.doorY - 70);
    this.walls = this.physics.add.staticGroup();
    const hx0 = house.x - house.displayWidth / 2 + 16, hx1 = house.x + house.displayWidth / 2 - 16, hy0 = house.y - house.displayHeight + 120, hy1 = house.y - 26;
    solidRect(this, this.walls, hx0, hy0, this.doorX - 34 - hx0, hy1 - hy0);
    solidRect(this, this.walls, this.doorX + 34, hy0, hx1 - this.doorX - 34, hy1 - hy0);
    solidRect(this, this.walls, hx0, hy0, hx1 - hx0, hy1 - 80 - hy0);
    this.drawDecorTrees();

    // ---- garden contents ----
    this.plotLayer = this.add.container(0, 0).setDepth(-5); // soil only; plants are scene children so they y-sort with the player
    this.fenceLayer = this.add.container(0, 0);
    this.grid = this.add.graphics().setDepth(4).setVisible(false);
    this.grid.lineStyle(1, 0xf0ebcc, 0.35);
    for (let i = 0; i <= this.n; i++) {
      this.grid.lineBetween(this.ox + (this.gc0 + i) * T, this.oy + this.gr0 * T, this.ox + (this.gc0 + i) * T, this.oy + (this.gr0 + this.n) * T);
      this.grid.lineBetween(this.ox + this.gc0 * T, this.oy + (this.gr0 + i) * T, this.ox + (this.gc0 + this.n) * T, this.oy + (this.gr0 + i) * T);
    }
    this.highlight = this.add.rectangle(0, 0, T, T).setStrokeStyle(3, 0xf0ebcc, 0.9).setFillStyle(0xffffff, 0.08).setDepth(5).setVisible(false);
    this.drawFences();
    this.drawPlots(); this.drawOutdoorFurniture();
    this.applySeason(effectiveSeason(this.view.owner.season, new Date().getMonth()));

    // ---- player ----
    const gateX = this.ox + (cx + 0.5) * T;
    const spawn = data.spawn === 'porch' ? [this.doorX, this.doorY + 30] : [gateX, this.oy + (this.gr0 + 2.6) * T];
    this.player = new Player(this, spawn[0], spawn[1], me().user.character ?? 0, me().user.username, true, PLAYER_SCALE);
    this.player.setCollideWorldBounds(true);
    this.physics.add.collider(this.player, this.walls);
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);
    this.keys = makeKeys(this);
    const guarded = (fn: () => void) => () => { if (!isPanelOpen() && !typingInDom() && !this.chatEl) fn(); };
    if (own) this.input.keyboard!.on('keydown-E', guarded(() => this.interact()));
    this.input.keyboard!.on('keydown-F', guarded(() => { this.player.emote('wave'); this.net?.emote('wave'); }));
    this.input.keyboard!.on('keydown-ENTER', guarded(() => this.openChat()));
    this.input.keyboard!.on('keydown-ESC', () => { if (!isPanelOpen()) { if (this.placing) this.stopPlacing(); else if (this.edit) this.setEdit(false); } });
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => { if (own && !isPanelOpen()) { if (this.placing) void this.placeFurniture(p); else if (this.edit) this.editClick(p); } });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.pointerMoved(p));
    this.events.once('shutdown', () => this.teardown());
    this.connect(own);
    setNavMode('garden');
    if (own) { gardenHud(this.n, { onEdit: () => this.setEdit(!this.edit), onSnapshot: () => this.snapshot() }); setVisitBadge(null); }
    else setVisitBadge(`Visiting ${this.view.owner.username}'s garden`);
    if (own) setHint('E on a tile: hoe / plant / grassify · Edit: fences, gates, moving · Enter chat · F wave · Shift run');
    else setHint(null);
    this.ready = true;
  }

  onMe() {
    if (!this.ready || this.ownerId !== me().user.id) return;
    if (gardenTiles(level().level) !== this.n) { this.scene.restart({ ownerId: this.ownerId, spawn: 'gate' }); return; } // levelled up: the garden grows
    const nextSeason = effectiveSeason(me().user.season, new Date().getMonth());
    if (nextSeason !== this.shownSeason) { this.scene.restart({ ownerId: this.ownerId, spawn: 'gate' }); return; }
    this.view.plots = me().plots; this.view.fences = me().fences; this.view.owner.wither = me().user.wither; this.view.owner.frozen = me().user.frozen; this.view.owner.season = me().user.season; this.view.owner.fence_color = me().user.fence_color; this.view.owner.growth = me().user.growth;
    this.view.furniture = me().placed.filter(p => p.location === 'garden');
    this.drawFences(); this.drawPlots(); this.drawOutdoorFurniture(); gardenHud(this.n, { onEdit: () => this.setEdit(!this.edit), onSnapshot: () => this.snapshot() });
    this.pendingRefresh = false;
  }

  /** Permanent scenery in the outer grass; a separate seed keeps it stable across redraws. */
  private drawDecorTrees() {
    const rnd = new Phaser.Math.RandomDataGenerator([`decor-trees-${this.ownerId}`]);
    const gx = this.ox + this.gc0 * T, gy = this.oy + this.gr0 * T, size = this.n * T;
    const keys = ['decor_tree_emerald', 'decor_tree_lime'];
    const placed: { x: number; y: number; r: number }[] = [];
    const place = (x: number, y: number, height: number) => {
      const key = keys[rnd.between(0, 1)];
      const src = this.textures.get(key).getSourceImage();
      const scale = Math.min(height / src.height, (MARGIN * T - 48) / src.width);
      // Bounding-circle radius so two canopies never overlap, whichever direction they're offset in.
      const r = Math.max(src.width, src.height) * scale / 2;
      for (const p of placed) if (Phaser.Math.Distance.Between(x, y, p.x, p.y) < r + p.r) return false;
      const tree = this.add.image(Math.round(x), Math.round(y), key).setOrigin(0.5, 1).setName('garden-decor-tree');
      tree.setScale(scale);
      tree.setFlipX(rnd.frac() < 0.5).setDepth(tree.y);
      // Only the trunk blocks walking; the canopy sorts above players behind it.
      solidRect(this, this.walls, tree.x - 14, tree.y - 20, 28, 20);
      placed.push({ x, y, r });
      return true;
    };
    // Random count and scatter — left margin, right margin, or below the fence — never inside it.
    const count = rnd.between(5, 10);
    for (let i = 0; i < count; i++) {
      const zone = rnd.frac();
      let x: number, y: number, height: number;
      if (zone < 0.42) { x = gx - rnd.realInRange(20, MARGIN * T - 20); y = gy + rnd.realInRange(0, size); height = rnd.between(150, 220); }
      else if (zone < 0.84) { x = gx + size + rnd.realInRange(20, MARGIN * T - 20); y = gy + rnd.realInRange(0, size); height = rnd.between(150, 220); }
      else { x = gx + rnd.realInRange(-20, size + 20); y = gy + size + rnd.realInRange(40, 150); height = rnd.between(140, 170); }
      for (let attempt = 0; attempt < 15 && !place(x, y, height); attempt++) { x += rnd.realInRange(-30, 30); y += rnd.realInRange(-30, 30); }
    }
  }

  // ---------- tiles ----------
  private tileAt(x: number, y: number): [number, number] | null {
    const tx = Math.floor((x - this.ox) / T) - this.gc0, ty = Math.floor((y - this.oy) / T) - this.gr0;
    return tx >= 0 && ty >= 0 && tx < this.n && ty < this.n ? [tx, ty] : null;
  }
  private tilePx(tx: number, ty: number) { return { x: this.ox + (this.gc0 + tx) * T, y: this.oy + (this.gr0 + ty) * T }; }
  private plotAt(tx: number, ty: number) { return this.view.plots.find((p) => p.tx === tx && p.ty === ty) ?? null; }
  private fenceAt(tx: number, ty: number) { return this.view.fences.find((f) => f.tx === tx && f.ty === ty) ?? null; }
  private interact() {
    if (isPomodoroActive()) return;
    const t = this.tileAt(this.player.x, this.player.y - 6);
    if (!t) return;
    if (this.placing || this.furnitureAt(t[0], t[1])) return;
    if (this.fenceAt(t[0], t[1])) { toast('There is a fence here. Use Edit to move it.'); return; }
    plotDialog(t[0], t[1], this.plotAt(t[0], t[1]));
  }

  // ---------- fences (autotiled from the four neighbours) ----------
  private drawFences() {
    this.fenceLayer.removeAll(true); this.fenceBodies.forEach((b) => b.destroy()); this.fenceBodies = []; this.gates = [];
    const has = (tx: number, ty: number) => !!this.fenceAt(tx, ty);
    const color = this.view.owner.fence_color || 'brown';
    for (const f of this.view.fences) {
      const n = has(f.tx, f.ty - 1), e = has(f.tx + 1, f.ty), s = has(f.tx, f.ty + 1), w = has(f.tx - 1, f.ty);
      const { x, y } = this.tilePx(f.tx, f.ty);
      const bx = x + T / 2, by = y + T - 2;
      if (f.kind === 'gate') {
        const vertical = !e && !w && (n || s);
        const img = this.add.image(bx, by, `fence_gate_${color}`).setOrigin(0.5, 1).setDepth(by);
        if (vertical) { img.setAngle(90).setOrigin(0.5, 0.5).setPosition(bx, y + T / 2); }
        this.fenceLayer.add(img); this.gates.push({ tx: f.tx, ty: f.ty, img, open: false, vertical });
        continue;
      }
      let piece: string = fencePiece(n, e, s, w);
      if (piece === 'h_m' && (f.tx + f.ty) % 3 === 0) piece = 'h_m2';
      if (piece === 'v_m' && (f.tx + f.ty) % 3 === 0) piece = 'v_m2';
      this.fenceLayer.add(this.add.image(bx, by, `fence_${piece}_${color}`).setOrigin(0.5, 1).setDepth(by));
      this.fenceBodies.push(solidRect(this, this.walls, x + 4, y + T * 0.45, T - 8, T * 0.5));
    }
  }
  private updateGates() {
    for (const g of this.gates) {
      const { x, y } = this.tilePx(g.tx, g.ty);
      const near = Math.abs(this.player.x - (x + T / 2)) < T * 1.1 && Math.abs(this.player.y - (y + T / 2)) < T * 1.1;
      if (near !== g.open) { g.open = near; g.img.setTexture(`fence_${near ? 'gate_open' : 'gate'}_${this.view.owner.fence_color || 'brown'}`); }
    }
  }

  // ---------- plots + plants ----------
  drawPlots() {
    this.plotLayer.removeAll(true);
    this.plantSprites.forEach((s) => s.destroy()); this.plantSprites = [];
    this.plantBodies.forEach((b) => b.destroy()); this.plantBodies = [];
    const wither = this.view.owner.wither / WITHER_MAX;
    const tint = Phaser.Display.Color.Interpolate.ColorWithColor(new Phaser.Display.Color(255, 255, 255), new Phaser.Display.Color(120, 115, 105), 1, wither);
    const tintHex = Phaser.Display.Color.GetColor(tint.r, tint.g, tint.b);
    const now = Date.now();
    for (const p of this.view.plots) {
      const { x, y } = this.tilePx(p.tx, p.ty);
      const stage = p.plant_id ? plantStage(p, now) : -1;
      // Mature plants blend into the lawn: grass underfoot instead of bare soil.
      if (p.plant_id && stage >= STAGES) {
        this.plotLayer.add(this.add.image(x, y, 'tinytown', TT.grass[p.id % TT.grass.length]).setOrigin(0).setScale(SCALE));
      } else {
        this.plotLayer.add(this.add.image(x, y, 'soil').setOrigin(0));
      }
      if (!p.plant_id) continue;
      const plant = plantById(p.plant_id)!;
      if (stage === 0) continue; // seed: bare soil for the first seconds
      const cx = x + T / 2, by = y + T * 0.72;   // the stem grows out of the middle of the soil
      const key = stage === 1 ? 'twig' : plantSprite(plant);
      const tex = this.textures.get(key).getSourceImage() as HTMLImageElement;
      const targetH = stage === 1 ? PLANT_H.twig : PLANT_H[plant.kind] * (stage === 2 ? 0.55 : 1);
      // Scene children (not plotLayer) so depth = foot Y sorts with Player.setDepth(y): walk above → behind plant, walk below → in front.
      const im = this.add.image(cx, by, key).setOrigin(0.5, 1).setScale(targetH / tex.height).setDepth(by).setTint(tintHex).setAlpha(1 - wither * 0.3);
      im.setInteractive({ pixelPerfect: false });
      im.on('pointerover', () => { this.hoverPlot = p; });
      im.on('pointerout', () => { if (this.hoverPlot === p) this.hoverPlot = null; });
      this.plantSprites.push(im);
      if (plant.kind === 'tree' && stage >= 2) this.plantBodies.push(solidRect(this, this.walls, cx - 16, by - 14, 32, 14));
    }
    if (this.hoverPlot && !this.view.plots.includes(this.hoverPlot)) this.hoverPlot = this.view.plots.find((q) => q.id === this.hoverPlot!.id) ?? null;
    // FROZEN banner is visual-only for visitors; only the owner freezes via Settings at home.
    this.freeze?.destroy(); this.freeze = undefined;
    if (this.view.owner.frozen) {
      const gx = this.ox + this.gc0 * T, gy = this.oy + this.gr0 * T, s = this.n * T;
      const r = this.add.rectangle(gx + s / 2, gy + s / 2, s, s, 0x9fd8ff, 0.35).setDepth(900).setInteractive(false);
      const label = this.ownerId === me().user.id ? '❄ FROZEN ❄' : `❄ ${this.view.owner.username}'s garden is frozen ❄`;
      const t = this.add.text(gx + s / 2, gy + 10, label, { fontFamily: 'Pixelify Sans', fontSize: '22px', color: '#e8f6ff', stroke: '#2a5a8a', strokeThickness: 5 }).setOrigin(0.5, 0).setDepth(901);
      this.freeze = this.add.container(0, 0, [r, t]);
    }
  }
  /** Hover tooltip: name, stage, time left and the harvest reward. Follows the pointer. */
  private updateTip(pointer: Phaser.Input.Pointer) {
    const p = this.hoverPlot;
    if (!p || !p.plant_id || this.edit) { this.tipEl?.remove(); this.tipEl = undefined; return; }
    if (!this.tipEl) { this.tipEl = document.createElement('div'); this.tipEl.id = 'tip'; document.getElementById('overlay')!.appendChild(this.tipEl); }
    const plant = plantById(p.plant_id)!, now = Date.now(), stage = plantStage(p, now), r = plantReward(plant, this.view.owner.growth);
    const names = ['Seed', 'Twig', 'Young', 'Fully grown'];
    const left = p.ready_at && stage < STAGES ? p.ready_at - now : 0;
    const mmss = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
    this.tipEl.innerHTML = `<b>${plant.name}</b> · ${names[stage]}<br/>${stage < STAGES ? `Fully grown in <span class="num">${mmss(left)}</span><br/>+<span class="num">${r.xp}</span> XP · +<span class="num">${r.coins}</span> coins when grown` : 'Fully grown'}`;
    const canvas = this.game.canvas.getBoundingClientRect(), sx = canvas.width / W;
    this.tipEl.style.left = `${canvas.left + pointer.x * sx + 16}px`; this.tipEl.style.top = `${canvas.top + pointer.y * sx - 10}px`;
  }

  // ---------- edit mode ----------
  private setEdit(on: boolean) {
    if (this.placing) this.stopPlacing();
    this.edit = on ? { tool: 'fence', moving: null } : null;
    this.grid.setVisible(on); this.highlight.setVisible(false);
    if (on) editPalette({ tool: 'fence', color: this.view.owner.fence_color, onTool: (t) => { if (this.edit) { this.edit.tool = t; this.edit.moving = null; } }, onColor: async (c) => { try { await api.post('/api/me/fence-color', { color: c }); await refreshMe(); } catch (e) { toast((e as Error).message, 'err'); } }, onDone: () => this.setEdit(false) });
    else hideEditPalette();
    setHint(on ? 'Edit: click tiles to place fences / gates, hoe plots, erase, or move plants · Esc when done' : null);
  }
  private pointerMoved(p: Phaser.Input.Pointer) {
    if (this.placing) { this.moveFurnitureGhost(p); return; }
    if (this.edit) {
      const t = this.tileAt(p.worldX, p.worldY);
      this.highlight.setVisible(!!t);
      if (t) { const { x, y } = this.tilePx(t[0], t[1]); this.highlight.setPosition(x + T / 2, y + T / 2); }
    }
    this.updateTip(p);
  }
  private async editClick(p: Phaser.Input.Pointer) {
    const t = this.tileAt(p.worldX, p.worldY);
    if (!t || !this.edit) return;
    const furniture = this.furnitureAt(t[0], t[1]);
    if (furniture) { this.openFurnitureMenu(furniture, p); return; }
    const [tx, ty] = t, plot = this.plotAt(tx, ty), fence = this.fenceAt(tx, ty), tool = this.edit.tool;
    const run = async (fn: () => Promise<unknown>) => { try { await fn(); await refreshMe(); } catch (e) { toast((e as Error).message, 'err'); } };
    if (tool === 'fence' || tool === 'gate') {
      if (fence?.kind === tool) return run(() => api.post('/api/garden/fence', { tx, ty, kind: null }));
      if (plot) return toast('There is a plot here', 'err');
      return run(() => api.post('/api/garden/fence', { tx, ty, kind: tool }));
    }
    if (tool === 'hoe') {
      if (fence) return toast('Remove the fence first', 'err');
      if (plot) return plotDialog(tx, ty, plot);
      return run(() => api.post('/api/plots/hoe', { tx, ty }));
    }
    if (tool === 'erase') {
      if (fence) return run(() => api.post('/api/garden/fence', { tx, ty, kind: null }));
      if (plot) {
        if (plot.plant_id && !(await confirmDialog('Grassify this plot?', `The ${plantById(plot.plant_id)!.name} growing here will be lost.`, 'Grassify', 'Keep'))) return;
        return run(() => api.post(`/api/plots/${plot.id}/remove`));
      }
      return;
    }
    if (tool === 'move') {
      if (this.edit.moving === null) {
        if (!plot) return toast('Click a plot to pick it up');
        this.edit.moving = plot.id; toast(`Picked up ${plot.plant_id ? plantById(plot.plant_id)!.name : 'the plot'} - click where it should go`);
        return;
      }
      const id = this.edit.moving; this.edit.moving = null;
      if (plot || fence) return toast('That tile is taken', 'err');
      return run(() => api.post(`/api/plots/${id}/move`, { tx, ty }));
    }
  }

  // ---------- outdoor furniture ----------
  private furnitureAt(tx: number, ty: number) {
    return this.view.furniture?.find(p => { const f = furnitureById(p.furniture_id); return f && tx >= p.cx && tx < p.cx + f.w && ty >= p.cy && ty < p.cy + f.h; });
  }
  private furniturePosition(cx: number, cy: number, w: number, h: number) {
    const p = this.tilePx(cx, cy); return { x: p.x + w * T / 2, y: p.y + h * T };
  }
  private sizeFurniture(im: Phaser.GameObjects.Image, id: number) {
    const f = furnitureById(id)!;
    im.setScale(Math.min(f.w * T / im.width, (f.h + 0.5) * T / im.height));
  }
  private drawOutdoorFurniture() {
    this.furnitureSprites.forEach(s => s.destroy()); this.furnitureSprites = [];
    this.furnitureBodies.forEach(b => b.destroy()); this.furnitureBodies = [];
    for (const p of this.view.furniture ?? []) {
      const f = furnitureById(p.furniture_id); if (!f) continue;
      const { x, y } = this.furniturePosition(p.cx, p.cy, f.w, f.h);
      const im = this.add.image(x, y, `f_${f.id}`).setOrigin(0.5, 1).setDepth(y).setName(`garden-furniture-${p.id}`);
      this.sizeFurniture(im, f.id); this.furnitureSprites.push(im);
      if (f.kind !== 'walk' && f.kind !== 'rug') this.furnitureBodies.push(solidRect(this, this.walls, x - im.displayWidth / 2 + 4, y - Math.min(im.displayHeight, f.h * T) + 4, im.displayWidth - 8, Math.min(im.displayHeight, f.h * T) - 8));
      if (this.ownerId === me().user.id) {
        im.setInteractive();
        im.on('pointerdown', (ptr: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
          if (this.edit && !this.placing && !isPanelOpen()) { ev.stopPropagation(); this.openFurnitureMenu(p, ptr); }
        });
      }
    }
  }
  startPlacing(furniture_id: number, placedId: number | null = null) {
    if (this.ownerId !== me().user.id || isPomodoroActive()) return;
    if (this.view.owner.frozen) { toast('Unfreeze your garden before decorating.', 'err'); return; }
    const f = furnitureById(furniture_id); if (!f || furnitureArea(furniture_id) !== 'garden') return;
    this.setEdit(false); this.placing = { furniture_id, placedId };
    this.ghost = this.add.image(0, 0, `f_${f.id}`).setOrigin(0.5, 1).setAlpha(0.7).setDepth(5000).setVisible(false);
    this.sizeFurniture(this.ghost, f.id); this.grid.setVisible(true);
    setHint(`Placing ${f.name}: click an empty garden tile. Esc to cancel.`);
  }
  private stopPlacing() {
    this.placing = null; this.ghost?.destroy(); this.ghost = undefined;
    this.grid.setVisible(!!this.edit); setHint(null);
  }
  private furnitureTarget(p: Phaser.Input.Pointer) {
    const f = furnitureById(this.placing!.furniture_id)!;
    return this.tileAt(p.worldX - (f.w - 1) * T / 2, p.worldY - (f.h - 1) * T / 2);
  }
  private furnitureFitsHere(cx: number, cy: number) {
    return gardenFurnitureFits(this.view.furniture ?? [], this.view.plots, this.view.fences, furnitureById(this.placing!.furniture_id)!, cx, cy, this.n, this.placing!.placedId ?? -1);
  }
  private moveFurnitureGhost(p: Phaser.Input.Pointer) {
    if (!this.ghost || !this.placing) return;
    const t = this.furnitureTarget(p); this.ghost.setVisible(!!t); if (!t) return;
    const f = furnitureById(this.placing.furniture_id)!, pos = this.furniturePosition(t[0], t[1], f.w, f.h);
    this.ghost.setPosition(pos.x, pos.y).setTint(this.furnitureFitsHere(...t) ? 0xbcffbc : 0xff9a9a);
  }
  private async placeFurniture(p: Phaser.Input.Pointer) {
    if (!this.placing || this.placingBusy) return;
    const t = this.furnitureTarget(p);
    if (!t || !this.furnitureFitsHere(...t)) { toast('Choose an empty tile away from the entrance, plots and fences.', 'err'); return; }
    const selection = this.placing; this.placingBusy = true;
    try {
      if (selection.placedId !== null) await api.post(`/api/furniture/${selection.placedId}/move`, { cx: t[0], cy: t[1] });
      else await api.post('/api/furniture/place', { furniture_id: selection.furniture_id, cx: t[0], cy: t[1] });
      await refreshMe(); if (this.placing === selection) this.stopPlacing(); toast('Garden furniture placed', 'reward');
    } catch (e) { toast((e as Error).message, 'err'); }
    finally { this.placingBusy = false; }
  }
  private openFurnitureMenu(p: PlacedFurniture, ptr: Phaser.Input.Pointer) {
    furnitureMenu(furnitureById(p.furniture_id)!.name, !!p.locked, ptr.x, ptr.y, {
      move: () => this.startPlacing(p.furniture_id, p.id),
      remove: async () => { try { await api.post(`/api/furniture/${p.id}/remove`); await refreshMe(); toast('Returned to your inventory'); } catch (e) { toast((e as Error).message, 'err'); } },
    });
  }

  // ---------- snapshot ----------
  /** Zoom the camera out to the whole garden for one frame, grab that part of the canvas, restore. */
  private snapshot() {
    const cam = this.cameras.main, zoom = Math.min(W / this.worldW, H / this.worldH);
    const hidden = this.children.list.filter((o) => /^(season|weather)-/.test(o.name)) as unknown as Phaser.GameObjects.Components.Visible[];
    hidden.forEach((o) => o.setVisible(false)); this.highlight.setVisible(false);
    cam.stopFollow(); cam.removeBounds(); cam.setZoom(zoom); cam.centerOn(this.worldW / 2, this.worldH / 2);
    this.game.renderer.snapshot((img) => {
      cam.setZoom(1); cam.setBounds(0, 0, this.worldW, this.worldH); cam.startFollow(this.player, true, 0.12, 0.12);
      hidden.forEach((o) => o.setVisible(true));
      const im = img as HTMLImageElement, scale = im.width / W;
      const sw = Math.round(this.worldW * zoom * scale), sh = Math.round(this.worldH * zoom * scale);
      const c = document.createElement('canvas'); c.width = sw; c.height = sh;
      c.getContext('2d')!.drawImage(im, Math.round((im.width - sw) / 2), Math.round((im.height - sh) / 2), sw, sh, 0, 0, sw, sh);
      const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = `ikigai-garden-${new Date().toISOString().slice(0, 10)}.png`; a.click();
      toast('Snapshot saved', 'reward');
    });
  }

  // ---------- seasons ----------
  /** A light tint plus falling particles: rain, snow or leaves. */
  private applySeason(season: GardenSeason) {
    this.shownSeason = season;
    if (season === 'summer') return;
    const style = { rainy: { color: 0x365f83, alpha: 0.12 }, fall: { color: 0xa83d2f, alpha: 0.12 }, winter: { color: 0xdce3e5, alpha: 0.16 } }[season];
    const overlay = this.add.rectangle(W / 2, H / 2, W, H, style.color, style.alpha).setScrollFactor(0).setDepth(1_000_000).setAlpha(0).setName(`season-${season}`);
    this.tweens.add({ targets: overlay, alpha: 1, duration: 300 });
    const key = `p_${season}`;
    if (!this.textures.exists(key)) {
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      if (season === 'rainy') g.fillStyle(0xcfe6ff, 0.9).fillRect(0, 0, 2, 14);
      else if (season === 'winter') g.fillStyle(0xffffff, 1).fillCircle(4, 4, 4);
      else g.fillStyle(0xd9663a, 1).fillRect(0, 0, 9, 6);
      g.generateTexture(key, season === 'rainy' ? 2 : 9, season === 'rainy' ? 14 : 8); g.destroy();
    }
    const cfg = season === 'rainy'
      ? { speedY: { min: 520, max: 720 }, speedX: { min: -60, max: -30 }, lifespan: 1800, frequency: 18, quantity: 3, scale: 1, rotate: 0 }
      : season === 'winter'
        ? { speedY: { min: 35, max: 80 }, speedX: { min: -25, max: 25 }, lifespan: 12000, frequency: 90, quantity: 1, scale: { min: 0.5, max: 1 }, rotate: 0 }
        : { speedY: { min: 50, max: 110 }, speedX: { min: -40, max: 40 }, lifespan: 9000, frequency: 160, quantity: 1, scale: { min: 0.7, max: 1.1 }, rotate: { min: 0, max: 360 } };
    const em = this.add.particles(0, 0, key, { x: { min: -60, max: W + 60 }, y: -20, alpha: { start: 0.95, end: 0.5 }, ...cfg });
    em.setScrollFactor(0).setDepth(999_999).setName(`weather-${season}`);
  }

  // ---------- realtime ----------
  private connect(own: boolean) {
    const goHome = () => {
      if (this.exiting) return;
      this.exiting = true;
      waitingOverlay(null);
      setVisitBadge(null);
      detachDomain(this.ownerId);
      this.scene.start('House', { spawn: 'hallway', ownerId: me().user.id });
    };
    this.net = attachDomain(this.ownerId, 'garden', {
      roster: (_you, peers) => {
        waitingOverlay(null);
        this.peers.forEach((p) => p.destroy()); this.peers.clear();
        peers.forEach((p) => this.addPeer(p));
        this.net?.resetMoveThrottle();
        this.net?.move(this.player.x, this.player.y, this.player.dir, false, 'garden');
      },
      join: (p) => { this.addPeer(p); if (own) toast(`${p.name} came to visit`); },
      leave: (id) => { this.peers.get(id)?.destroy(); this.peers.delete(id); },
      move: (m) => {
        if (m.area === 'house') { this.peers.get(m.id)?.destroy(); this.peers.delete(m.id); return; }
        let p = this.peers.get(m.id);
        if (!p) {
          const known = domainPeer(m.id);
          this.addPeer({ id: m.id, name: known?.name ?? 'friend', character: known?.character ?? 0, x: m.x, y: m.y, dir: m.dir, moving: m.moving, area: 'garden' });
          p = this.peers.get(m.id);
        }
        if (!p) return;
        (p as any).target = { x: m.x, y: m.y }; p.setFacing(m.dir as Dir, m.moving);
      },
      chat: (id, text) => { const p = id === me().user.id ? this.player : this.peers.get(id); if (p) { p.typing = false; p.say(text); } },
      typing: (id, on) => { const p = this.peers.get(id); if (!p) return; if (on) { p.say('. . .', 0); p.typing = true; } else if (p.typing) { p.typing = false; p.clearBubble(); } },
      emote: (id, kind) => this.peers.get(id)?.emote(kind),
      knocking: () => { /* waiting overlay already shown on Visit */ },
      knock: () => { /* doorbell is delivered via the hub */ },
      denied: () => { waitingOverlay(null); toast(`${this.view.owner.username} is not home right now`, 'err'); goHome(); },
    });
  }
  private addPeer(p: PeerState) {
    if (p.id === me().user.id || this.peers.has(p.id)) return;
    if (p.area === 'house') return; // missing area = treat as here until their first move
    const x = (p.x && p.x > 1) ? p.x : this.doorX;
    const y = (p.y && p.y > 1) ? p.y : this.oy + (this.gr0 + 2.6) * T;
    const pl = new Player(this, x, y, p.character, p.name, false, PLAYER_SCALE);
    pl.body!.enable = false;
    (pl as any).target = { x, y };
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
    // Keep the domain socket open when switching to this owner's house
    this.peers.forEach((p) => p.destroy()); this.peers.clear();
    this.chatEl?.remove(); this.chatEl = undefined;
    this.tipEl?.remove(); this.tipEl = undefined; this.hoverPlot = null;
    this.ghost?.destroy(); this.ghost = undefined; this.placing = null; this.placingBusy = false;
    this.furnitureSprites.forEach(s => s.destroy()); this.furnitureSprites = [];
    this.furnitureBodies.forEach(b => b.destroy()); this.furnitureBodies = [];
    document.getElementById('fmenu')?.remove();
    hideGardenHud(); hideEditPalette(); setNavMode('house');
    this.net = undefined;
  }

  update(_t: number, dt: number) {
    if (!this.ready || this.exiting || !this.player.body) return;
    const [vx, vy, run] = isPanelOpen() || typingInDom() || this.chatEl ? [0, 0, false] : readInput(this.keys);
    this.player.drive(vx, vy, run, dt);
    this.net?.move(this.player.x, this.player.y, this.player.dir, this.player.moving, 'garden');
    for (const p of this.peers.values()) { const t = (p as any).target; if (t) { p.x += (t.x - p.x) * 0.25; p.y += (t.y - p.y) * 0.25; } }
    this.updateGates();
    const now = Date.now();
    if (!this.pendingRefresh && this.view.plots.some((p) => p.plant_id && p.ready_at && p.stage < STAGES && (now >= p.ready_at || (now - p.planted_at! < 12_000 && now - p.planted_at! > 10_000)))) {
      // a seed just sprouted or a plant just matured: redraw (maturing also settles the reward on the server)
      this.pendingRefresh = true;
      if (this.ownerId === me().user.id) refreshMe().catch(() => { this.pendingRefresh = false; });
      else { this.drawPlots(); setTimeout(() => { this.pendingRefresh = false; }, 2000); }
    }
    if (!this.edit && !this.placing) {
      const own = this.ownerId === me().user.id;
      const tileHere = own ? this.tileAt(this.player.x, this.player.y - 6) : null;
      this.highlight.setVisible(!!tileHere);
      if (tileHere) { const { x, y } = this.tilePx(tileHere[0], tileHere[1]); this.highlight.setPosition(x + T / 2, y + T / 2); }
    }
    if (this.tipEl) this.updateTip(this.input.activePointer);
    if (document.getElementById('waiting')) return; // still knocking — stay in the garden until accepted / cancelled
    if (Math.abs(this.player.x - this.doorX) < 36 && this.player.y < this.doorY - 22 && this.player.dir === 'up') {
      this.exiting = true;
      const ownerId = this.ownerId;
      const cam = this.cameras.main;
      let done = false;
      const go = () => { if (done) return; done = true; this.scene.start('House', { spawn: 'door', ownerId }); };
      cam.once('camerafadeoutcomplete', go);
      cam.fadeOut(250, 11, 15, 10);
      this.time.delayedCall(700, go);
    }
  }
}
export type { Plot, FenceTile };
