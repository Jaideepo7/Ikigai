import Phaser from 'phaser';
import { Player, makeKeys, readInput } from './Player';
import { me, level } from '../state';
import { friendsPanel, cardCasePanel, isPanelOpen, setHint } from '../ui/panels';
import { CARDS, caseSlots } from '../shared/rules';

/** Static room from the mockup + hand-placed collision boxes. Exits: bottom door / left edge -> garden, right edge -> friends. */
const FLOOR = { x1: 180, y1: 200, x2: 1286, y2: 735 };
const OBSTACLES: [number, number, number, number][] = [
  [211, 177, 411, 505], [422, 208, 514, 361], [530, 239, 576, 320], [813, 208, 1039, 361], [874, 331, 957, 413],
  [1090, 105, 1275, 361], [1170, 520, 1250, 556], [1010, 600, 1140, 700], [998, 700, 1060, 730], [1190, 660, 1250, 720],
  [206, 546, 411, 720], [411, 576, 504, 720],
];
const CASE_ZONE = { x1: 940, y1: 300, x2: 1290, y2: 480 };

export class HouseScene extends Phaser.Scene {
  player!: Player;
  keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private cardSprites: Phaser.GameObjects.GameObject[] = [];
  private exiting = false;
  constructor() { super('House'); }

  create(data: { spawn?: 'center' | 'door' | 'left' }) {
    this.exiting = false;
    this.add.image(0, 0, 'house').setOrigin(0);
    const spawn = data.spawn === 'door' ? [730, 720] : data.spawn === 'left' ? [230, 470] : [700, 500];
    this.player = new Player(this, spawn[0], spawn[1], me().user.character ?? 0, me().user.username, true);
    this.keys = makeKeys(this);
    const walls = this.physics.add.staticGroup();
    const box = (x1: number, y1: number, x2: number, y2: number) => { const r = this.add.rectangle((x1 + x2) / 2, (y1 + y2) / 2, x2 - x1, y2 - y1); this.physics.add.existing(r, true); walls.add(r); };
    OBSTACLES.forEach((o) => box(...o));
    box(FLOOR.x1 - 40, FLOOR.y1 - 40, FLOOR.x2 + 40, FLOOR.y1);          // back wall
    box(FLOOR.x1 - 40, FLOOR.y2, 640, FLOOR.y2 + 40);                     // bottom wall left of door
    box(820, FLOOR.y2, FLOOR.x2 + 40, FLOOR.y2 + 40);                     // bottom wall right of door
    this.physics.add.collider(this.player, walls);
    this.input.keyboard!.on('keydown-E', () => { if (!isPanelOpen() && this.nearCase()) cardCasePanel(); });
    this.drawCards();
    setHint('WASD / arrows to move · walk out the door or left to your garden · right to visit friends · E near the bookshelf for your card case');
  }
  onMe() { this.drawCards(); }
  private nearCase() { const { x, y } = this.player; return x > CASE_ZONE.x1 && x < CASE_ZONE.x2 && y > CASE_ZONE.y1 && y < CASE_ZONE.y2; }

  /** Placed cards show on the bookshelf as small framed pictures. */
  private drawCards() {
    this.cardSprites.forEach((s) => s.destroy()); this.cardSprites = [];
    const placed = me().cards.filter((c) => c.slot !== null).sort((a, b) => a.slot! - b.slot!);
    const slots = caseSlots(level().level);
    for (let i = 0; i < slots; i++) {
      const col = i % 3, row = Math.floor(i / 3);
      const x = 1115 + col * 54, y = 130 + row * 46;
      const frame = this.add.rectangle(x, y, 44, 38, 0x3d2915).setStrokeStyle(2, 0xd9c8a5).setDepth(50);
      this.cardSprites.push(frame);
      const c = placed.find((p) => p.slot === i);
      if (!c) continue;
      const card = CARDS[c.card_id];
      if (card.art) this.cardSprites.push(this.add.image(x, y, `card_${card.id}`).setDisplaySize(40, 34).setDepth(51));
      else this.cardSprites.push(this.add.text(x, y, card.name.split(' ').map((w) => w[0]).join(''), { fontFamily: 'Pixelify Sans', fontSize: '16px', color: '#F0EBCC' }).setOrigin(0.5).setDepth(51));
    }
  }

  update(_t: number, dt: number) {
    if (this.exiting) return;
    const [vx, vy] = isPanelOpen() ? [0, 0] : readInput(this.keys);
    this.player.drive(vx, vy, dt);
    setHint(this.nearCase() && !isPanelOpen() ? 'Press E to open your card case' : null);
    const { x, y } = this.player;
    if (y > FLOOR.y2 + 6 && x > 640 && x < 820) return this.leave('Garden', { ownerId: me().user.id, spawn: 'porch' });
    if (x < FLOOR.x1 + 6) return this.leave('Garden', { ownerId: me().user.id, spawn: 'gate' });
    if (x > FLOOR.x2 - 30) { this.player.x = FLOOR.x2 - 70; this.player.setFacing('left', false); friendsPanel(); }
  }
  private leave(scene: string, data: object) {
    this.exiting = true;
    this.cameras.main.fadeOut(250, 11, 15, 10);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start(scene, data));
  }
}
