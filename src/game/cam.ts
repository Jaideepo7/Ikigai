import type Phaser from 'phaser';

/** Hard-clear camera fade/flash so scene switches never stick on a black screen. */
export function revealCamera(scene: Phaser.Scene) {
  const cam = scene.cameras.main;
  cam.resetFX();
  // fadeIn() starts fully opaque; if the tween never runs (async create), the world stays black.
  const fade = (cam as unknown as { fadeEffect?: { reset: () => void; isRunning?: boolean; alpha?: number } }).fadeEffect;
  fade?.reset?.();
  cam.setAlpha(1);
  cam.alpha = 1;
}
