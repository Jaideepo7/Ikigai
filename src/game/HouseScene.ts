import Phaser from 'phaser';
import { Player, makeKeys, readInput, typingInDom, type Dir } from './Player';
import { me } from '../state';
import { api } from '../api';
import { refreshMe, toast } from '../state';
import { friendsPanel, cardCasePanel, tasksPanel, sleepPanel, isPanelOpen, isPomodoroActive, setHint, houseHud, hideHouseHud, furnitureMenu, setNavMode, knockPrompt, waitingOverlay } from '../ui/panels';
import { ROOM, furnitureById, furnitureFits, type PlacedFurniture, type HouseView } from '../shared/rules';
import { T, solidRect } from './tiles';
import { goto, POMODORO_LOCK_MSG } from './index';
import { Net, type PeerState } from './net';
import { attachDomain, detachDomain, domainNet, domainPeer } from './domainNet';
import { sfx } from '../ui/audio';

/**
 * The player's home (or a friend's), drawn on the room template (1536 x 1024). Furniture lives on a 17 x 7 tile grid.
 * Hotspots (press E) attach to placed furniture when it is your own room: bed = sleep, desk = task book, bookcase = card case.
 * Exits: bottom gateway = that owner's garden; own home has a right-wall gateway to Friends; a friend's home has a left gateway back to yours.
 * Realtime peers share the domain socket with the garden (knock once, then free house ↔ garden).
 */
const ROOM_X0 = 233, ROOM_Y0 = 386, WORLD_W = 1536, WORLD_H = 1024;
const FLOOR = { x0: 215, y0: 370, x1: 1340, y1: 850 };
const DOOR = { x0: 700, x1: 870 };
const HALL = { y0: 560, y1: 690 };
const FURNITURE_SCALE = 1.5;
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
  private net?: Net;
  private peers = new Map<number, Player>();
  private chatEl?: HTMLDivElement;
  constructor() { super('House'); }

  async create(data: { spawn?: HouseSpawn; ownerId?: number } = {}) {
    this.teardown();
    this.ready = false; this.exiting = false; this.placing = null; this.editing = false;
    this.furnitureSprites = []; this.furnitureBodies = []; this.spots = []; this.visitPlaced = null; this.visitName = '';
    this.ownerId = data.ownerId ?? me().user.id;
    const own = this.ownerId === me().user.id;

    if (!own) {
      const view = await api.get<HouseView>(`/api/house/${this.ownerId}`).catch((e) => { toast(e.message, 'err'); return null; });
      if (!view) { detachDomain(this.ownerId); this.scene.start('House', { spawn: 'hallway', ownerId: me().user.id }); return; }
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
    const guarded = (fn: () => void) => () => { if (!isPanelOpen() && !typingInDom() && !this.chatEl) fn(); };
    this.input.keyboard!.on('keydown-E', () => { if (own && !isPanelOpen() && !typingInDom() && !this.placing) this.interact(); });
    this.input.keyboard!.on('keydown-F', guarded(() => { this.player.emote('wave'); this.net?.emote('wave'); }));
    this.input.keyboard!.on('keydown-ENTER', guarded(() => this.openChat()));
    this.input.keyboard!.on('keydown-ESC', () => { if (this.placing && !isPanelOpen()) this.stopPlacing(); else if (this.editing && !isPanelOpen()) this.setEditing(false); });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.moveGhost(p));
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => { if (this.placing && !isPanelOpen()) this.placeAt(p); });
    this.drawFurniture();
    this.connect(own);
    setNavMode('house');
    if (own) houseHud({ onEdit: () => this.setEditing(!this.editing) });
    else hideHouseHud();
    this.events.once('shutdown', () => this.teardown());
    setHint(own
      ? 'WASD / arrows move · Shift run · E: bed = sleep, desk = tasks, bookcase = cards · Enter chat · F wave · bottom gateway = garden · right gateway = friends'
      : `Visiting ${this.visitName}'s home · Enter chat · F wave · bottom gateway = their garden · left gateway = back to your home`);
    this.ready = true;
  }

  // ---------- realtime (shared with garden for this owner) ----------
  private connect(own: boolean) {
    const goHome = () => {
      if (this.exiting) return;
      this.exiting = true;
      waitingOverlay(null);
      detachDomain(this.ownerId);
      this.scene.start('House', { spawn: 'hallway', ownerId: me().user.id });
    };
    this.net = attachDomain(this.ownerId, 'house', {
      roster: (_you, peers) => { waitingOverlay(null); this.peers.forEach((p) => p.destroy()); this.peers.clear(); peers.forEach((p) => this.addPeer(p)); },
      join: (p) => { this.addPeer(p); if (own) toast(`${p.name} came to visit`); },
      leave: (id) => { this.peers.get(id)?.destroy(); this.peers.delete(id); },
      move: (m) => {
        if (m.area === 'garden') { this.peers.get(m.id)?.destroy(); this.peers.delete(m.id); return; }
        let p = this.peers.get(m.id);
        if (!p) {
          const known = domainPeer(m.id);
          this.addPeer({ id: m.id, name: known?.name ?? 'friend', character: known?.character ?? 0, x: m.x, y: m.y, dir: m.dir, moving: m.moving, area: 'house' });
          p = this.peers.get(m.id);
        }
        if (!p) return;
        (p as any).target = { x: m.x, y: m.y }; p.setFacing(m.dir as Dir, m.moving);
      },
      chat: (id, text) => { const p = id === me().user.id ? this.player : this.peers.get(id); if (p) { p.typing = false; p.say(text); } },
      typing: (id, on) => { const p = this.peers.get(id); if (!p) return; if (on) { p.say('. . .', 0); p.typing = true; } else if (p.typing) { p.typing = false; p.clearBubble(); } },
      emote: (id, kind) => this.peers.get(id)?.emote(kind),
      knocking: () => { sfx.chime(); waitingOverlay(this.visitName || 'friend', () => goHome()); },
      knock: (p) => { sfx.chime(); knockPrompt(p.name, p.character, (accept) => domainNet()?.visit(p.id, accept)); },
      denied: () => { waitingOverlay(null); toast(`${this.visitName || 'They'} are busy right now`, 'err'); goHome(); },
    });
  }
  private addPeer(p: PeerState) {
    if (p.id === me().user.id || this.peers.has(p.id)) return;
    if (p.area === 'garden') return; // missing area = treat as here until their first move
    const midY = (HALL.y0 + HALL.y1) / 2 + 30;
    const pl = new Player(this, p.x || (DOOR.x0 + DOOR.x1) / 2, p.y || midY, p.character, p.name, false);
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
    input.addEventListener('blur', () => setTimeout(close, 100));
    setTimeout(() => input.focus(), 0);
  }
  private teardown() {
    // Keep the domain socket open when switching to this owner's garden
    this.peers.forEach((p) => p.destroy()); this.peers.clear();
    this.chatEl?.remove(); this.chatEl = undefined;
    hideHouseHud(); document.getElementById('fmenu')?.remove();
    this.net = undefined;
  }

  /** Side gateways matching the bottom garden exit: a notch in the room border into a dark opening, with a floor mat and label. */
  private drawHallways(own: boolean) {
    const g = this.add.graphics().setDepth(-15);
    const labelStyle = { fontFamily: 'Pixelify Sans', fontSize: '14px', color: '#F0EBCC', stroke: '#103523', strokeThickness: 3 } as const;
    const draw = (side: 'left' | 'right', label: string) => {
      const gap = HALL.y1 - HALL.y0;
      const out = 70; // depth of the notch outside the floor, like the garden steps
      const xEdge = side === 'right' ? FLOOR.x1 : FLOOR.x0;
      const dir = side === 'right' ? 1 : -1;
      // dark void beyond the room (same feel as outside the bottom gateway)
      g.fillStyle(0x0b0f0a);
      g.fillRect(side === 'right' ? xEdge : xEdge - out, HALL.y0 - 8, out + 8, gap + 16);
      // wooden outer border notch (matches the light-brown frame around the room)
      g.fillStyle(0xb39871);
      g.fillRect(side === 'right' ? xEdge : xEdge - out, HALL.y0 - 10, out, 10);
      g.fillRect(side === 'right' ? xEdge : xEdge - out, HALL.y1, out, 10);
      g.fillRect(side === 'right' ? xEdge + out - 10 : xEdge - out, HALL.y0 - 10, 10, gap + 20);
      // steps / planks leading out through the gateway
      g.fillStyle(0x8b5a2b);
      for (let i = 0; i < 3; i++) {
        const sx = side === 'right' ? xEdge + 4 + i * 18 : xEdge - 22 - i * 18;
        g.fillRect(sx, HALL.y0 + 8, 16, gap - 16);
        g.fillStyle(0x6b4423).fillRect(sx, HALL.y1 - 10, 16, 4);
        g.fillStyle(0x8b5a2b);
      }
      // small floor mat at the threshold (like the garden doorway mat)
      g.fillStyle(0x2f5a3a);
      g.fillRect(side === 'right' ? xEdge - 28 : xEdge + 4, HALL.y0 + gap / 2 - 18, 24, 36);
      g.fillStyle(0x1e3d28);
      g.fillRect(side === 'right' ? xEdge - 24 : xEdge + 8, HALL.y0 + gap / 2 - 12, 16, 24);
      const labelX = side === 'right' ? xEdge + out / 2 : xEdge - out / 2;
      this.add.text(labelX, HALL.y1 + 14, label, labelStyle).setOrigin(0.5, 0).setDepth(2000);
      void dir;
    };
    if (own) draw('right', 'friends');
    else draw('left', 'home');
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
      const bodyW = Math.max(f.w * T, im.displayWidth) - 12;
      const bodyH = Math.min(im.displayHeight, f.h * T * FURNITURE_SCALE) - 12;
      const bodyX = x - bodyW / 2, bodyY = y - bodyH - 6;
      if (f.kind !== 'rug' && f.kind !== 'walk') this.furnitureBodies.push(solidRect(this, this.walls, bodyX, bodyY, bodyW, bodyH));
      const spot = f.kind === 'bed' ? 'bed' : f.kind === 'desk' ? 'desk' : f.kind === 'bookcase' ? 'case' : null;
      if (spot && own) this.spots.push({ kind: spot, x1: bodyX - T, y1: bodyY - T, x2: bodyX + bodyW + T, y2: y + T });
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
    const waiting = !!document.getElementById('waiting');
    const [vx, vy, run] = waiting || isPanelOpen() || typingInDom() || this.chatEl ? [0, 0, false] : readInput(this.keys);
    this.player.drive(vx, vy, run, dt);
    // Tall furniture can legitimately sort in front of someone walking behind it.
    // Fade only the overlapping piece so the player stays visible while navigating.
    const playerBounds = this.player.getBounds();
    for (const furniture of this.furnitureSprites) {
      const coversPlayer = furniture.depth > this.player.y &&
        Phaser.Geom.Intersects.RectangleToRectangle(playerBounds, furniture.getBounds());
      furniture.setAlpha(coversPlayer ? 0.4 : 1);
    }
    if (!waiting) this.net?.move(this.player.x, this.player.y, this.player.dir, this.player.moving, 'house');
    for (const p of this.peers.values()) { const t = (p as any).target; if (t) { p.x += (t.x - p.x) * 0.25; p.y += (t.y - p.y) * 0.25; } }
    const s = this.spotAt();
    if (own && !this.placing && !this.editing) setHint(isPanelOpen() ? null : s === 'bed' ? 'E: sleep and see your day' : s === 'desk' ? 'E: open your task book' : s === 'case' ? 'E: open the card case' : null);
    if (waiting) return; // still knocking — stay put until accepted / cancelled
    const { x, y } = this.player;
    if (y > FLOOR.y1 + 40 && x > DOOR.x0 && x < DOOR.x1) { this.exiting = true; this.leaveToGarden(); }
    else if (own && x > FLOOR.x1 - 10 && y > HALL.y0 && y < HALL.y1 + 20) { this.player.x = FLOOR.x1 - 50; this.player.setFacing('left', false); friendsPanel(); }
    else if (!own && x < FLOOR.x0 + 10 && y > HALL.y0 && y < HALL.y1 + 20) { this.exiting = true; this.leaveToOwnHome(); }
  }
  private leaveToOwnHome() {
    detachDomain(this.ownerId);
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
