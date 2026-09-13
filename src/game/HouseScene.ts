import Phaser from 'phaser';
import { Player, makeKeys, readInput, typingInDom } from './Player';
import { me } from '../state';
import { api } from '../api';
import { refreshMe, toast } from '../state';
import { friendsPanel, cardCasePanel, tasksPanel, sleepPanel, isPanelOpen, isPomodoroActive, setHint, houseHud, hideHouseHud, furnitureMenu, setNavMode } from '../ui/panels';
import { ROOM, furnitureById, furnitureFits, type PlacedFurniture } from '../shared/rules';
import { T, solidRect } from './tiles';
import { goto, POMODORO_LOCK_MSG } from './index';

/**
 * The player's home, drawn on the room template (1536 x 1024). Furniture lives on a 17 x 7 tile grid on the floor.
 * Hotspots (press E) attach to placed furniture: bed = sleep, desk = task book, bookcase = card case.
 * Doors: bottom = garden, right wall = friends. Placement mode comes from the inventory (or the Edit room button).
 */
const ROOM_X0 = 233, ROOM_Y0 = 386, WORLD_W = 1536, WORLD_H = 1024;
const FLOOR = { x0: 215, y0: 370, x1: 1340, y1: 850 };
const DOOR = { x0: 700, x1: 870 };
const FRIENDS_DOOR = { y0: 560, y1: 690 };
const FURNITURE_SCALE = 2;
type Spot = 'bed' | 'desk' | 'case';
type Place = { furniture_id: number; placedId: number | null };

export class HouseScene extends Phaser.Scene {
  player!: Player;
  keys!: Record<string, Phaser.Input.Keyboard.Key>;
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
  constructor() { super('House'); }

  create(data: { spawn?: 'center' | 'door' | 'friends' }) {
    this.ready = false; this.exiting = false; this.placing = null; this.editing = false; this.furnitureSprites = []; this.furnitureBodies = []; this.spots = [];
    this.physics.world.setBounds(0, 0, WORLD_W, WORLD_H);
    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);
    this.add.image(0, 0, 'home_bg').setOrigin(0).setDepth(-20);
    // friends door on the right wall (drawn: the template has no side door)
    const door = this.add.graphics().setDepth(-15);
    door.fillStyle(0x4a2e14).fillRect(FLOOR.x1 - 14, FRIENDS_DOOR.y0, 40, FRIENDS_DOOR.y1 - FRIENDS_DOOR.y0).fillStyle(0x8b5a2b).fillRect(FLOOR.x1 - 8, FRIENDS_DOOR.y0 + 6, 28, FRIENDS_DOOR.y1 - FRIENDS_DOOR.y0 - 12).fillStyle(0xd9a23c).fillCircle(FLOOR.x1 - 2, (FRIENDS_DOOR.y0 + FRIENDS_DOOR.y1) / 2, 4);
    this.add.text(FLOOR.x1 + 6, FRIENDS_DOOR.y0 - 6, 'friends', { fontFamily: 'Pixelify Sans', fontSize: '14px', color: '#F0EBCC', stroke: '#103523', strokeThickness: 3 }).setOrigin(0.5, 1).setDepth(2000);
    this.add.text((DOOR.x0 + DOOR.x1) / 2, FLOOR.y1 + 60, 'garden', { fontFamily: 'Pixelify Sans', fontSize: '14px', color: '#F0EBCC', stroke: '#103523', strokeThickness: 3 }).setOrigin(0.5, 0).setDepth(2000);

    this.walls = this.physics.add.staticGroup();
    const solid = (x: number, y: number, w: number, h: number) => solidRect(this, this.walls, x, y, w, h);
    solid(0, 0, WORLD_W, FLOOR.y0 - 30);
    solid(0, 0, FLOOR.x0, WORLD_H);
    solid(FLOOR.x1, 0, WORLD_W - FLOOR.x1, FRIENDS_DOOR.y0); solid(FLOOR.x1, FRIENDS_DOOR.y1, WORLD_W - FLOOR.x1, WORLD_H - FRIENDS_DOOR.y1);
    solid(0, FLOOR.y1 + 20, DOOR.x0, WORLD_H - FLOOR.y1); solid(DOOR.x1, FLOOR.y1 + 20, WORLD_W - DOOR.x1, WORLD_H - FLOOR.y1);

    this.grid = this.add.graphics().setDepth(3).setVisible(false);
    this.grid.lineStyle(1, 0xf0ebcc, 0.35);
    for (let i = 0; i <= ROOM.cols; i++) this.grid.lineBetween(ROOM_X0 + i * T, ROOM_Y0, ROOM_X0 + i * T, ROOM_Y0 + ROOM.rows * T);
    for (let j = 0; j <= ROOM.rows; j++) this.grid.lineBetween(ROOM_X0, ROOM_Y0 + j * T, ROOM_X0 + ROOM.cols * T, ROOM_Y0 + j * T);

    const spawn = data.spawn === 'door' ? [(DOOR.x0 + DOOR.x1) / 2, FLOOR.y1 - 10] : data.spawn === 'friends' ? [FLOOR.x1 - 60, (FRIENDS_DOOR.y0 + FRIENDS_DOOR.y1) / 2 + 30] : [(DOOR.x0 + DOOR.x1) / 2, ROOM_Y0 + 4 * T];
    this.player = new Player(this, spawn[0], spawn[1], me().user.character ?? 0, me().user.username, true);
    this.player.setCollideWorldBounds(true);
    this.physics.add.collider(this.player, this.walls);
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);
    this.keys = makeKeys(this);
    this.input.keyboard!.on('keydown-E', () => { if (!isPanelOpen() && !typingInDom() && !this.placing) this.interact(); });
    this.input.keyboard!.on('keydown-F', () => { if (!isPanelOpen() && !typingInDom()) this.player.emote('wave'); });
    this.input.keyboard!.on('keydown-ESC', () => { if (this.placing && !isPanelOpen()) this.stopPlacing(); else if (this.editing && !isPanelOpen()) this.setEditing(false); });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.moveGhost(p));
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => { if (this.placing && !isPanelOpen()) this.placeAt(p); });
    this.drawFurniture();
    setNavMode('house');
    houseHud({ onEdit: () => this.setEditing(!this.editing) });
    this.events.once('shutdown', () => { hideHouseHud(); document.getElementById('fmenu')?.remove(); });
    setHint('WASD / arrows move · Shift run · E: bed = sleep, desk = tasks, bookcase = cards · F wave · bottom door = garden · right door = friends');
    this.ready = true;
  }
  onMe() { if (this.ready) this.drawFurniture(); }

  // ---------- furniture ----------
  private tileToPx(cx: number, cy: number, w: number, h: number) { return { x: ROOM_X0 + (cx + w / 2) * T, y: ROOM_Y0 + (cy + h) * T }; }
  private tileAt(x: number, y: number): [number, number] { return [Math.floor((x - ROOM_X0) / T), Math.floor((y - ROOM_Y0) / T)]; }
  private drawFurniture() {
    this.furnitureSprites.forEach((s) => s.destroy()); this.furnitureSprites = [];
    this.furnitureBodies.forEach((b) => b.destroy()); this.furnitureBodies = []; this.spots = [];
    for (const p of me().placed) {
      const f = furnitureById(p.furniture_id); if (!f) continue;
      const { x, y } = this.tileToPx(p.cx, p.cy, f.w, f.h);
      const im = this.add.image(x, y, `f_${f.id}`).setOrigin(0.5, 1).setScale(FURNITURE_SCALE).setDepth(f.kind === 'rug' ? -5 : y - (f.kind === 'walk' ? 20 : 0)).setName(`room-furniture-${p.id}`);
      im.setInteractive();
      im.on('pointerdown', (ptr: Phaser.Input.Pointer, _lx: number, _ly: number, ev: Phaser.Types.Input.EventData) => { if (this.editing && !this.placing && !isPanelOpen()) { ev.stopPropagation(); this.openMenu(p, ptr); } });
      this.furnitureSprites.push(im);
      if (f.kind !== 'rug' && f.kind !== 'walk') this.furnitureBodies.push(solidRect(this, this.walls, ROOM_X0 + p.cx * T + 6, ROOM_Y0 + p.cy * T + 6, f.w * T - 12, f.h * T - 12));
      const spot = f.kind === 'bed' ? 'bed' : f.kind === 'desk' ? 'desk' : f.kind === 'bookcase' ? 'case' : null;
      if (spot) this.spots.push({ kind: spot, x1: ROOM_X0 + (p.cx - 1) * T, y1: ROOM_Y0 + (p.cy - 1) * T, x2: ROOM_X0 + (p.cx + f.w + 1) * T, y2: ROOM_Y0 + (p.cy + f.h + 1) * T });
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
    this.editing = on; this.grid.setVisible(on || !!this.placing);
    houseHud({ onEdit: () => this.setEditing(!this.editing) }, on);
    setHint(on ? 'Edit room: click a piece to move it or put it back in your inventory · Esc when done' : null);
    if (!on) document.getElementById('fmenu')?.remove();
  }
  /** Called from the inventory: pick a piece, then click a tile. */
  startPlacing(furniture_id: number, placedId: number | null = null) {
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
    const [vx, vy, run] = isPanelOpen() || typingInDom() ? [0, 0, false] : readInput(this.keys);
    this.player.drive(vx, vy, run, dt);
    const s = this.spotAt();
    if (!this.placing && !this.editing) setHint(isPanelOpen() ? null : s === 'bed' ? 'E: sleep and see your day' : s === 'desk' ? 'E: open your task book' : s === 'case' ? 'E: open the card case' : null);
    const { x, y } = this.player;
    if (y > FLOOR.y1 + 40 && x > DOOR.x0 && x < DOOR.x1) { this.exiting = true; this.leaveToGarden(); }
    else if (x > FLOOR.x1 - 10 && y > FRIENDS_DOOR.y0 && y < FRIENDS_DOOR.y1 + 20) { this.player.x = FLOOR.x1 - 50; this.player.setFacing('left', false); friendsPanel(); }
  }
  private async leaveToGarden() {
    const data = { ownerId: me().user.id, spawn: 'porch' };
    const stepBack = () => { this.player.setVelocity(0, 0); this.player.y = FLOOR.y1 - 30; this.player.setFacing('up', false); this.exiting = false; };
    if (isPomodoroActive()) { toast(POMODORO_LOCK_MSG, 'err'); stepBack(); return; }
    if (me().user.frozen) { stepBack(); await goto('Garden', data); return; }   // goto() shows the unfreeze dialog
    this.cameras.main.fadeOut(250, 11, 15, 10);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('Garden', data));
  }
}
