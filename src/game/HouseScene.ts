import Phaser from 'phaser';
import { Player, makeKeys, readInput, typingInDom } from './Player';
import { me, level } from '../state';
import { friendsPanel, cardCasePanel, tasksPanel, sleepPanel, isPanelOpen, isPomodoroActive, setHint } from '../ui/panels';
import { CARDS, caseSlots } from '../shared/rules';
import { T, W, H, INNER, layerFrom, block, tile, solidRect } from './tiles';
import { goto } from './index';

/**
 * The player's room, built from the Zelda-like interior tiles: 20 x 12 tiles at 64px.
 * Hotspots (press E): bed = sleep, desk = task book, bookshelf = card case. Doors: bottom = garden, right = friends.
 */
const COLS = 20, ROWS = 12;
const OX = Math.round((W - COLS * T) / 2), OY = Math.round((H - ROWS * T) / 2);
const px = (c: number) => OX + c * T, py = (r: number) => OY + r * T;
type Spot = 'bed' | 'desk' | 'case';

export class HouseScene extends Phaser.Scene {
  player!: Player;
  keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private cardSprites: Phaser.GameObjects.GameObject[] = [];
  private spots: { kind: Spot; x1: number; y1: number; x2: number; y2: number }[] = [];
  private exiting = false;
  private ready = false;
  constructor() { super('House'); }

  create(data: { spawn?: 'center' | 'door' | 'friends' }) {
    this.ready = false; this.exiting = false; this.cardSprites = []; this.spots = [];
    // ---- floor + walls ----
    const grid: number[][] = [];
    for (let r = 0; r < ROWS; r++) {
      const row: number[] = [];
      for (let c = 0; c < COLS; c++) {
        if (r === 0) row.push(INNER.wallTop);
        else if (r === 1) row.push(c === 0 ? INNER.wallL : c === COLS - 1 ? INNER.wallR : INNER.wall);
        else if (c === 0) row.push(INNER.wallL);
        else if (c === COLS - 1) row.push(INNER.wallR);
        else if (r === ROWS - 1 && (c === 9 || c === 10)) row.push(INNER.floor[0]); // doorway
        else if (r === ROWS - 1) row.push(INNER.wallBottom);
        else row.push(INNER.floor[(c * 5 + r * 3) % 7 === 0 ? 2 : 0]);
      }
      grid.push(row);
    }
    layerFrom(this, 'inner_img', grid, OX, OY, -10);
    this.add.rectangle(0, 0, W, H, 0x0b0f0a).setOrigin(0).setDepth(-20);
    // wall decor
    block(this, 'inner', 40, INNER.window, px(7), py(2), -5); block(this, 'inner', 40, INNER.window, px(13), py(2), -5);
    block(this, 'inner', 40, INNER.painting, px(10.5), py(2), -5);
    block(this, 'inner', 40, INNER.door, px(COLS - 0.5), py(8), py(8)); // friends door on the right wall
    this.add.text(px(COLS - 0.5), py(8) + 6, 'friends', { fontFamily: 'Pixelify Sans', fontSize: '13px', color: '#F0EBCC', stroke: '#103523', strokeThickness: 3 }).setOrigin(0.5, 0).setDepth(2000);
    this.add.text(px(10), py(ROWS) - 8, 'garden', { fontFamily: 'Pixelify Sans', fontSize: '13px', color: '#F0EBCC', stroke: '#103523', strokeThickness: 3 }).setOrigin(0.5, 1).setDepth(2000);

    // ---- furniture (bottom-centre anchored blocks) ----
    const walls = this.physics.add.staticGroup();
    const solid = (c1: number, r1: number, c2: number, r2: number) => solidRect(this, walls, px(c1), py(r1), (c2 - c1) * T, (r2 - r1) * T);
    block(this, 'inner', 40, INNER.rug, px(10), py(9), -8);
    block(this, 'inner', 40, INNER.bed, px(2), py(5)); solid(1, 2.6, 3, 5);
    block(this, 'inner', 40, INNER.dresser, px(4), py(4)); solid(3, 2.6, 5, 4);
    block(this, 'inner', 40, INNER.stove, px(6), py(4)); solid(5, 2.6, 7, 4);
    block(this, 'inner', 40, INNER.table, px(14.5), py(5)); tile(this, 'inner', INNER.chair, px(14.5), py(6)); solid(13, 2.8, 16, 5);
    this.add.image(px(14.5), py(4) - 12, 'book').setScale(3).setDepth(py(5) + 1);
    block(this, 'inner', 40, INNER.bookshelf, px(17.5), py(4)); solid(16, 2.6, 19, 4);
    block(this, 'inner', 40, INNER.sideboard, px(2.5), py(11)); solid(1, 9.6, 4, 11);
    block(this, 'inner', 40, INNER.plantTall, px(1.5), py(7)); solid(1, 6.3, 2, 7);
    tile(this, 'inner', INNER.plant, px(18.5), py(11)); solid(18, 10.4, 19, 11);
    tile(this, 'inner', INNER.plant, px(12.5), py(11)); solid(12, 10.4, 13, 11);
    // walls: top (below the wall rows), sides, bottom with the doorway gap, right wall with the friends door gap
    solid(0, 0, COLS, 2); solid(0, 0, 1, ROWS); solid(COLS - 1, 0, COLS, 6.9); solid(COLS - 1, 8.1, COLS, ROWS);
    solid(0, ROWS - 1, 9, ROWS); solid(11, ROWS - 1, COLS, ROWS);
    this.spots = [
      { kind: 'bed', x1: px(1), y1: py(4), x2: px(4), y2: py(6.5) },
      { kind: 'desk', x1: px(12.5), y1: py(4.5), x2: px(16.5), y2: py(7) },
      { kind: 'case', x1: px(15.5), y1: py(3.5), x2: px(19), y2: py(6) },
    ];

    const spawn = data.spawn === 'door' ? [px(10), py(11) - 4] : data.spawn === 'friends' ? [px(18), py(8)] : [px(10), py(8)];
    this.player = new Player(this, spawn[0], spawn[1], me().user.character ?? 0, me().user.username, true);
    this.physics.add.collider(this.player, walls);
    this.keys = makeKeys(this);
    this.input.keyboard!.on('keydown-E', () => { if (!isPanelOpen() && !typingInDom()) this.interact(); });
    this.input.keyboard!.on('keydown-F', () => { if (!isPanelOpen() && !typingInDom()) this.player.emote('wave'); });
    this.drawCards();
    setHint('WASD / arrows move · Shift run · E: bed = sleep, desk = tasks, shelf = cards · F wave · bottom door = garden · right door = friends');
    this.ready = true;
  }
  onMe() { if (this.ready) this.drawCards(); }
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

  /** Placed cards show on the bookshelf as small framed pictures. */
  private drawCards() {
    this.cardSprites.forEach((s) => s.destroy()); this.cardSprites = [];
    const placed = me().cards.filter((c) => c.slot !== null);
    const slots = caseSlots(level().level);
    for (let i = 0; i < slots; i++) {
      const col = i % 4, row = Math.floor(i / 4);
      const x = px(16.35) + col * 46, y = py(2.55) + row * 44;
      this.cardSprites.push(this.add.rectangle(x, y, 40, 36, 0x3d2915).setStrokeStyle(2, 0xd9c8a5).setDepth(py(4) + 2));
      const c = placed.find((p) => p.slot === i);
      if (!c) continue;
      const card = CARDS[c.card_id];
      if (card.art) this.cardSprites.push(this.add.image(x, y, `card_${card.id}`).setDisplaySize(36, 32).setDepth(py(4) + 3));
      else this.cardSprites.push(this.add.text(x, y, card.name.split(' ').map((w) => w[0]).join(''), { fontFamily: 'Pixelify Sans', fontSize: '15px', color: '#F0EBCC' }).setOrigin(0.5).setDepth(py(4) + 3));
    }
  }

  update(_t: number, dt: number) {
    if (!this.ready || this.exiting) return;
    const [vx, vy, run] = isPanelOpen() || typingInDom() ? [0, 0, false] : readInput(this.keys);
    this.player.drive(vx, vy, run, dt);
    const s = this.spotAt();
    setHint(isPanelOpen() ? null : s === 'bed' ? 'E: sleep and see your day' : s === 'desk' ? 'E: open your task book' : s === 'case' ? 'E: open the card case' : null);
    const { x, y } = this.player;
    if (y > py(ROWS) - 2 && x > px(9) && x < px(11)) { this.exiting = true; this.leaveToGarden(); }
    else if (x > px(COLS - 1) - 6 && y > py(6.9) && y < py(8.2)) { this.player.x = px(COLS - 1) - 50; this.player.setFacing('left', false); friendsPanel(); }
  }
  private async leaveToGarden() {
    const data = { ownerId: me().user.id, spawn: 'porch' };
    if (isPomodoroActive()) {
      this.player.setVelocity(0, 0); this.player.y = py(ROWS) - 70; this.player.setFacing('up', false);
      this.exiting = false;
      return;
    }
    if (me().user.frozen) {
      // goto() shows the unfreeze dialog; if the user declines, step back inside
      this.player.setVelocity(0, 0); this.player.y = py(ROWS) - 70; this.player.setFacing('up', false);
      await goto('Garden', data);
      this.exiting = false;
      return;
    }
    this.cameras.main.fadeOut(250, 11, 15, 10);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('Garden', data));
  }
}
