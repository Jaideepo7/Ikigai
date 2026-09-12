import Phaser from 'phaser';

/** Canvas size (logical px) and 16px source tiles drawn at 4x = 64px world tiles. */
export const W = 1440, H = 848;
export const T = 64, SCALE = 4;

/** Kenney Tiny Town (12 columns). Index = row * 12 + col, see tools contact sheet. */
export const TT = {
  grass: [0, 1], grassFlower: 2,
  dirt: 25, dirtEdge: { tl: 12, t: 13, tr: 14, l: 24, r: 26, bl: 36, b: 37, br: 38 }, path: [40, 41],
  fence: { tl: 44, t: 45, tr: 46, l: 56, r: 58, bl: 68, b: 69, br: 70, post: 47 },
  trees: [5, 16, 8, 28, 4], bush: 6, sprout: 17, mushroom: 29, rock: 43,
  roof: { l: 52, m: 53, r: 54, l2: 64, m2: 65, r2: 66 }, wall: { l: 72, m: 73, r: 75, door: 74, window: 84 }, chimney: 51,
  crate: 106, barrel: 107, beehive: 94, hay: 93, sign: 83, pot: 107,
};
/** Zelda-like Inner sheet (40 columns). */
export const IN = (x: number, y: number) => y * 40 + x;
export const INNER = {
  floor: [IN(1, 4), IN(1, 4), IN(1, 5)], wallTop: IN(2, 0), wall: IN(2, 1), wallL: IN(1, 1), wallR: IN(3, 1), wallBottom: IN(2, 2),
  rug: { x: 0, y: 7, w: 3, h: 3 }, bed: { x: 16, y: 1, w: 2, h: 3 }, bookshelf: { x: 0, y: 11, w: 3, h: 2 }, dresser: { x: 6, y: 9, w: 2, h: 2 },
  table: { x: 10, y: 1, w: 3, h: 3 }, chair: IN(11, 4), stove: { x: 12, y: 10, w: 2, h: 2 }, plant: IN(11, 10), plantTall: { x: 8, y: 12, w: 1, h: 2 },
  window: { x: 9, y: 4, w: 2, h: 1 }, door: { x: 5, y: 1, w: 1, h: 2 }, painting: { x: 13, y: 0, w: 3, h: 1 }, painting2: { x: 16, y: 0, w: 3, h: 1 }, sideboard: { x: 10, y: 7, w: 3, h: 2 },
};

/** Build a tilemap layer from a 2D array of frame indices (-1 = empty). */
export function layerFrom(scene: Phaser.Scene, sheet: string, data: number[][], x = 0, y = 0, depth = -10) {
  const map = scene.make.tilemap({ data, tileWidth: 16, tileHeight: 16 });
  const set = map.addTilesetImage(sheet, sheet, 16, 16, 0, 0)!;
  const layer = map.createLayer(0, set, x, y)!;
  layer.setScale(SCALE).setDepth(depth);
  return layer;
}
/** Place a w x h block of tiles from a sheet as one image group (returns bottom-centre anchored container). */
export function block(scene: Phaser.Scene, sheet: string, cols: number, b: { x: number; y: number; w: number; h: number }, wx: number, wy: number, depth?: number) {
  const c = scene.add.container(wx, wy);
  for (let j = 0; j < b.h; j++) for (let i = 0; i < b.w; i++) {
    c.add(scene.add.image(-b.w * T / 2 + i * T, -b.h * T + j * T, sheet, (b.y + j) * cols + b.x + i).setOrigin(0).setScale(SCALE));
  }
  c.setDepth(depth ?? wy);
  return c;
}
export function tile(scene: Phaser.Scene, sheet: string, frame: number, wx: number, wy: number, depth?: number) {
  return scene.add.image(wx, wy, sheet, frame).setOrigin(0.5, 1).setScale(SCALE).setDepth(depth ?? wy);
}
export function solidRect(scene: Phaser.Scene, group: Phaser.Physics.Arcade.StaticGroup, x: number, y: number, w: number, h: number) {
  const r = scene.add.rectangle(x + w / 2, y + h / 2, w, h); scene.physics.add.existing(r, true); group.add(r); return r;
}
