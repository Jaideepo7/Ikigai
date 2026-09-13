import Phaser from 'phaser';

/** Canvas size (logical px) and 16px source tiles drawn at 4x = 64px world tiles. */
export const W = 1440, H = 848;
export const T = 64, SCALE = 4;

/** Kenney Tiny Town (12 columns): only the ground tiles are still used (grass, path). Index = row * 12 + col. */
export const TT = { grass: [0, 1], grassFlower: 2, path: [40, 41] };

/** Build a tilemap layer from a 2D array of frame indices (-1 = empty). */
export function layerFrom(scene: Phaser.Scene, sheet: string, data: number[][], x = 0, y = 0, depth = -10) {
  const map = scene.make.tilemap({ data, tileWidth: 16, tileHeight: 16 });
  const set = map.addTilesetImage(sheet, sheet, 16, 16, 0, 0)!;
  const layer = map.createLayer(0, set, x, y)!;
  layer.setScale(SCALE).setDepth(depth);
  return layer;
}
export function solidRect(scene: Phaser.Scene, group: Phaser.Physics.Arcade.StaticGroup, x: number, y: number, w: number, h: number) {
  const r = scene.add.rectangle(x + w / 2, y + h / 2, w, h); scene.physics.add.existing(r, true); group.add(r); return r;
}
