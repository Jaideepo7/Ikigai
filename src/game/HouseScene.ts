import Phaser from 'phaser';
import { Player, makeKeys, readInput, typingInDom } from './Player';
import { me } from '../state';
import { api } from '../api';
import { refreshMe, toast } from '../state';
import { friendsPanel, cardCasePanel, tasksPanel, sleepPanel, isPanelOpen, isPomodoroActive, setHint, houseHud, hideHouseHud, furnitureMenu, setNavMode } from '../ui/panels';
import { ROOM, furnitureById, furnitureFits, type PlacedFurniture, type HouseView } from '../shared/rules';
import { T, solidRect } from './tiles';
import { goto, POMODORO_LOCK_MSG } from './index';

/**
 * The player's home (or a friend's), drawn on the room template (1536 x 1024). Furniture lives on a 17 x 7 tile grid.
 * Hotspots (press E) attach to placed furniture when it is your own room: bed = sleep, desk = task book, bookcase = card case.
 * Exits: bottom door = that owner's garden; own home has a right-wall hallway to Friends; a friend's home has a left hollow back to yours.
 */
const ROOM_X0 = 233, ROOM_Y0 = 386, WORLD_W = 1536, WORLD_H = 1024;
const FLOOR = { x0: 215, y0: 370, x1: 1340, y1: 850 };
const DOOR = { x0: 700, x1: 870 };
const FRIENDS_DOOR = { y0: 560, y1: 690 };
const FURNITURE_SCALE = 2;
type Spot = 'bed' | 'desk' | 'case';
type Place = { furniture_id: number; placedId: number | null };
type HouseSpawn = 'center' | 'door' | 'friends' | 'hallway';

export class HouseScene extends Phaser.Scene {
  player!: Player;
  keys!: Record<string, Phaser.Input.Keyboard.Key>;
  ownerId = 0;
  private walls!: Phaser.Physics.Arcade.StaticGroup;
  private furnitureSprites: Phaser.GameObjects.Image[] = [];
  private furnitureBodies: Phaser.GameObjects.GameObject[] = [];
  private spots: { kind: Spot; x1: number; y1: number; x2: number; y2: number }[] = [];
  private grid!: Phaser.GameObjects.Graphics;
  private ghost?: Phaser.GameObjects.Image;
  private placing: Place | null = null;
  private editing = false;
  private exiting = false;
  private ready = false;
  private visitPlaced: PlacedFurniture[] | null = null;
  private visitName = '';
  constructor() { super('House'); }

  async create(data: { spawn?: HouseSpawn; ownerId?: number } = {}) {
    this.ready = false; this.exiting = false; this.placing = null; this.editing = false;
    this.furnitureSprites = []; this.furnitureBodies = []; this.spots = []; this.visitPlaced = null; this.visitName = '';
    this.ownerId = data.ownerId ?? me().user.id;
    const own = this.ownerId === me().user.id;

    if (!own) {
      const view = await api.get<HouseView>(`/api/house/${this.ownerId}`).catch((e) => { toast(e.message, 'err'); return null; });
      if (!view) { this.scene.start('House', { spawn: 'hallway' }); return; }
      this.visitPlaced = view.placed;
      this.visitName = view.owner.username;
    }

    this.physics.world.setBounds(0, 0, WORLD_W, WORLD_H);
    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);
    this.add.image(0, 0, 'home_bg').setOrigin(0).setDepth(-20);

    this.drawHallways(own);
    this.add.text((DOOR.x0 + DOOR.x1) / 2, FLOOR.y1 + 60, 'garden', { fontFamily: 'Pixelify Sans', fontSize: '14px', color: '#F0EBCC', stroke: '#103523', strokeThickness: 3 }).setOrigin(0.5, 0).setDepth(2000);

    this.walls = this.physics.add.staticGroup();
    const solid = (x: number, y: number, w: number, h: number) => solidRect(this, this.walls, x, y, w, h);
    solid(0, 0, WORLD_W, FLOOR.y0 - 30);
    // Left wall: open hollow when visiting a friend (way back home); solid in your own room
    if (own) solid(0, 0, FLOOR.x0, WORLD_H);
    else {
      solid(0, 0, FLOOR.x0, HALL.y0);
      solid(0, HALL.y1, FLOOR.x0, WORLD_H - HALL.y1);
    }
    // Right wall: friends hallway in your own room; solid when visiting
    if (own) {
      solid(FLOOR.x1, 0, WORLD_W - FLOOR.x1, HALL.y0);
      solid(FLOOR.x1, HALL.y1, WORLD_W - FLOOR.x1, WORLD_H - HALL.y1);
    } else solid(FLOOR.x1, 0, WORLD_W - FLOOR.x1, WORLD_H);
    solid(0, FLOOR.y1 + 20, DOOR.x0, WORLD_H - FLOOR.y1); solid(DOOR.x1, FLOOR.y1 + 20, WORLD_W - DOOR.x1, WORLD_H - FLOOR.y1);

    this.grid = this.add.graphics().setDepth(3).setVisible(false);
    this.grid.lineStyle(1, 0xf0ebcc, 0.35);
    for (let i = 0; i <= ROOM.cols; i++) this.grid.lineBetween(ROOM_X0 + i * T, ROOM_Y0, ROOM_X0 + i * T, ROOM_Y0 + ROOM.rows * T);
    for (let j = 0; j <= ROOM.rows; j++) this.grid.lineBetween(ROOM_X0, ROOM_Y0 + j * T, ROOM_X0 + ROOM.cols * T, ROOM_Y0 + j * T);

    const midY = (HALL.y0 + HALL.y1) / 2 + 30;
    let sx: number, sy: number;
    if (data.spawn === 'door') { sx = (DOOR.x0 + DOOR.x1) / 2; sy = FLOOR.y1 - 10; }
    else if (!own) { sx = FLOOR.x0 + 60; sy = midY; }                         // arrive through the left hollow
    else if (data.spawn === 'friends' || data.spawn === 'hallway') { sx = FLOOR.x1 - 60; sy = midY; }
    else { sx = (DOOR.x0 + DOOR.x1) / 2; sy = ROOM_Y0 + 4 * T; }
    this.player = new Player(this, sx, sy, me().user.character ?? 0, me().user.username, true);
    if (!own && data.spawn !== 'door') this.player.setFacing('right', false);
    else if (own && (data.spawn === 'friends' || data.spawn === 'hallway')) this.player.setFacing('left', false);
    this.player.setCollideWorldBounds(true);
    this.physics.add.collider(this.player, this.walls);
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);
    this.keys = makeKeys(this);
    this.input.keyboard!.on('keydown-E', () => { if (own && !isPanelOpen() && !typingInDom() && !this.placing) this.interact(); });
    this.input.keyboard!.on('keydown-F', () => { if (!isPanelOpen() && !typingInDom()) this.player.emote('wave'); });
    this.input.keyboard!.on('keydown-ESC', () => { if (this.placing && !isPanelOpen()) this.stopPlacing(); else if (this.editing && !isPanelOpen()) this.setEditing(false); });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.moveGhost(p));
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => { if (this.placing && !isPanelOpen()) this.placeAt(p); });
    this.drawFurniture();
    setNavMode('house');
    if (own) houseHud({ onEdit: () => this.setEditing(!this.editing) });
    else hideHouseHud();
    this.events.once('shutdown', () => { hideHouseHud(); document.getElementById('fmenu')?.remove(); });
    setHint(own
      ? 'WASD / arrows move · Shift run · E: bed = sleep, desk = tasks, bookcase = cards · F wave · bottom door = garden · right hallway = friends'
      : `Visiting ${this.visitName}'s home · bottom door = their garden · left hallway = back to your home`);
    this.ready = true;
  }

  /** Hallway openings: a dark corridor recess instead of a framed door with a knob. */
  private drawHallways(own: boolean) {
    const g = this.add.graphics().setDepth(-15);
    const draw = (x0: number, outward: 1 | -1, label: string, labelX: number) => {
      const w = 56, mid = (HALL.y0 + HALL.y1) / 2;
      // frame
      g.fillStyle(0x3a2412).fillRect(x0 - (outward < 0 ? w : 0), HALL.y0 - 4, w, HALL.y1 - HALL.y0 + 8);
      // dark corridor
      g.fillStyle(0x0c0a08).fillRect(x0 - (outward < 0 ? w - 6 : 6), HALL.y0 + 4, w - 12, HALL.y1 - HALL.y0 - 8);
      // floor boards fading into the dark
      g.fillStyle(0x4a3220);
      for (let i = 0; i < 4; i++) {
        const t = i / 4, bw = 10 + i * 6, bh = 10 - i;
        const bx = outward > 0 ? x0 + 8 + i * 10 : x0 - 8 - i * 10 - bw;
        g.fillRect(bx, mid - bh / 2, bw, bh);
        g.fillStyle(0x2a1a10).fillRect(bx, mid + bh / 2 - 1, bw, 2);
        g.fillStyle(0x4a3220);
        void t;
      }
      // side posts
      g.fillStyle(0x6b4423).fillRect(x0 - (outward < 0 ? 4 : 0), HALL.y0 - 6, 4, HALL.y1 - HALL.y0 + 12);
      this.add.text(labelX, HALL.y0 - 6, label, { fontFamily: 'Pixelify Sans', fontSize: '14px', color: '#F0EBCC', stroke: '#103523', strokeThickness: 3 }).setOrigin(0.5, 1).setDepth(2000);
    };
    if (own) draw(FLOOR.x1 - 6, 1, 'friends', FLOOR.x1 + 18);
    else draw(FLOOR.x0 + 6, -1, 'home', FLOOR.x0 - 18);
  }

  onMe() { if (this.ready && this.ownerId === me().user.id) this.drawFurniture(); }

  // ---------- furniture ----------
  private placedList() { return this.visitPlaced ?? me().placed; }
  private tileToPx(cx: number, cy: number, w: number, h: number) { return { x: ROOM_X0 + (cx + w / 2) * T, y: ROOM_Y0 + (cy + h) * T }; }
  private tileAt(x: number, y: number): [number, number] { return [Math.floor((x - ROOM_X0) / T), Math.floor((y - ROOM_Y0) / T)]; }
  private drawFurniture() {
    this.furnitureSprites.forEach((s) => s.destroy()); this.furnitureSprites = [];
    this.furnitureBodies.forEach((b) => b.destroy()); this.furnitureBodies = []; this.spots = [];
    const own = this.ownerId === me().user.id;
    for (const p of this.placedList()) {
      const f = furnitureById(p.furniture_id); if (!f) continue;
      const { x, y } = this.tileToPx(p.cx, p.cy, f.w, f.h);
      const im = this.add.image(x, y, `f_${f.id}`).setOrigin(0.5, 1).setScale(FURNITURE_SCALE).setDepth(f.kind === 'rug' ? -5 : y - (f.kind === 'walk' ? 20 : 0)).setName(`room-furniture-${p.id}`);
      if (own) {
        im.setInteractive();
        im.on('pointerdown', (ptr: Phaser.Input.Pointer, _lx: number, _ly: number, ev: Phaser.Types.Input.EventData) => { if (this.editing && !this.placing && !isPanelOpen()) { ev.stopPropagation(); this.openMenu(p, ptr); } });
      }
      this.furnitureSprites.push(im);
      if (f.kind !== 'rug' && f.kind !== 'walk') this.furnitureBodies.push(solidRect(this, this.walls, ROOM_X0 + p.cx * T + 6, ROOM_Y0 + p.cy * T + 6, f.w * T - 12, f.h * T - 12));
      const spot = f.kind === 'bed' ? 'bed' : f.kind === 'desk' ? 'desk' : f.kind === 'bookcase' ? 'case' : null;
      if (spot && own) this.spots.push({ kind: spot, x1: ROOM_X0 + (p.cx - 1) * T, y1: ROOM_Y0 + (p.cy - 1) * T, x2: ROOM_X0 + (p.cx + f.w + 1) * T, y2: ROOM_Y0 + (p.cy + f.h + 1) * T });
    }
  }
  private spotAt(): Spot | null {
    const { x, y } = this.player;
    return this.spots.find((s) => x > s.x1 && x < s.x2 && y > s.y1 && y < s.y2)?.kind ?? null;
  }
  private interact() {
    const s = this.spotAt();
    if (s === 'bed') { this.player.emote('sleep'); sleepPanel(); }
    else if (s === 'desk') tasksPanel();
    else if (s === 'case') cardCasePanel();
  }

  // ---------- placement / editing ----------
  private setEditing(on: boolean) {
    if (this.ownerId !== me().user.id) return;
    this.editing = on; this.grid.setVisible(on || !!this.placing);
    houseHud({ onEdit: () => this.setEditing(!this.editing) }, on);
    setHint(on ? 'Edit room: click a piece to move it or put it back in your inventory · Esc when done' : null);
    if (!on) document.getElementById('fmenu')?.remove();
  }
  /** Called from the inventory: pick a piece, then click a tile. */
  startPlacing(furniture_id: number, placedId: number | null = null) {
    if (this.ownerId !== me().user.id) return;
    this.stopPlacing();
    const f = furnitureById(furniture_id); if (!f) return;
    this.placing = { furniture_id, placedId };
    this.ghost = this.add.image(0, 0, `f_${f.id}`).setOrigin(0.5, 1).setScale(FURNITURE_SCALE).setAlpha(0.7).setDepth(5000).setVisible(false);
    this.grid.setVisible(true);
    setHint(`Placing ${f.name}: click a floor tile (one tile of space around furniture) · Esc to cancel`);
  }
  private stopPlacing() {
    this.placing = null; this.ghost?.destroy(); this.ghost = undefined; this.grid.setVisible(this.editing);
    setHint(null);
  }
  private moveGhost(p: Phaser.Input.Pointer) {
    if (!this.placing || !this.ghost) return;
    const f = furnitureById(this.placing.furniture_id)!;
    const [cx, cy] = this.tileAt(p.worldX - (f.w * T) / 2 + T / 2, p.worldY - (f.h * T) / 2 + T / 2);
    const ok = furnitureFits(me().placed, f, cx, cy, this.placing.placedId ?? -1);
    const { x, y } = this.tileToPx(cx, cy, f.w, f.h);
    this.ghost.setPosition(x, y).setVisible(true).setTint(ok ? 0xbcffbc : 0xff9a9a);
  }
  private async placeAt(p: Phaser.Input.Pointer) {
    if (!this.placing) return;
    const f = furnitureById(this.placing.furniture_id)!;
    const [cx, cy] = this.tileAt(p.worldX - (f.w * T) / 2 + T / 2, p.worldY - (f.h * T) / 2 + T / 2);
    if (!furnitureFits(me().placed, f, cx, cy, this.placing.placedId ?? -1)) { toast('It does not fit there - keep one tile free around furniture', 'err'); return; }
    try {
      if (this.placing.placedId !== null) await api.post(`/api/furniture/${this.placing.placedId}/move`, { cx, cy });
      else await api.post('/api/furniture/place', { furniture_id: f.id, cx, cy });
      await refreshMe(); this.stopPlacing(); toast(`${f.name} placed`, 'reward');
    } catch (e) { toast((e as Error).message, 'err'); }
  }
  private openMenu(p: PlacedFurniture, ptr: Phaser.Input.Pointer) {
    const f = furnitureById(p.furniture_id)!;
    furnitureMenu(f.name, !!p.locked, ptr.x, ptr.y, {
      move: () => this.startPlacing(p.furniture_id, p.id),
      remove: async () => { try { await api.post(`/api/furniture/${p.id}/remove`); await refreshMe(); toast(`${f.name} is back in your inventory`); } catch (e) { toast((e as Error).message, 'err'); } },
    });
  }

  update(_t: number, dt: number) {
    if (!this.ready || this.exiting) return;
    const own = this.ownerId === me().user.id;
    const [vx, vy, run] = isPanelOpen() || typingInDom() ? [0, 0, false] : readInput(this.keys);
    this.player.drive(vx, vy, run, dt);
    const s = this.spotAt();
    if (own && !this.placing && !this.editing) setHint(isPanelOpen() ? null : s === 'bed' ? 'E: sleep and see your day' : s === 'desk' ? 'E: open your task book' : s === 'case' ? 'E: open the card case' : null);
    const { x, y } = this.player;
    if (y > FLOOR.y1 + 40 && x > DOOR.x0 && x < DOOR.x1) { this.exiting = true; this.leaveToGarden(); }
    else if (own && x > FLOOR.x1 - 10 && y > HALL.y0 && y < HALL.y1 + 20) { this.player.x = FLOOR.x1 - 50; this.player.setFacing('left', false); friendsPanel(); }
    else if (!own && x < FLOOR.x0 + 10 && y > HALL.y0 && y < HALL.y1 + 20) { this.exiting = true; this.leaveToOwnHome(); }
  }
  private leaveToOwnHome() {
    this.cameras.main.fadeOut(250, 11, 15, 10);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('House', { spawn: 'hallway', ownerId: me().user.id }));
  }
  private async leaveToGarden() {
    const data = { ownerId: this.ownerId, spawn: 'porch' as const };
    const stepBack = () => { this.player.setVelocity(0, 0); this.player.y = FLOOR.y1 - 30; this.player.setFacing('up', false); this.exiting = false; };
    if (this.ownerId === me().user.id) {
      if (isPomodoroActive()) { toast(POMODORO_LOCK_MSG, 'err'); stepBack(); return; }
      if (me().user.frozen) { stepBack(); await goto('Garden', data); return; }   // goto() shows the unfreeze dialog
    }
    this.cameras.main.fadeOut(250, 11, 15, 10);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('Garden', data));
  }
}
