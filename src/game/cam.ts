import type Phaser from 'phaser';

/**
 * Phaser keeps drawing a finished fadeOut (isComplete + alpha 1) until reset.
 * Always clear before/after scene work — never rely on fadeIn to undo a fadeOut.
 */
export function revealCamera(scene: Phaser.Scene) {
  const cam = scene.cameras.main;
  cam.resetFX();
  const fade = (cam as unknown as { fadeEffect?: { reset: () => void; isRunning: boolean; isComplete: boolean; alpha: number } }).fadeEffect;
  if (fade) {
    fade.reset();
    fade.alpha = 0;
    fade.isRunning = false;
    fade.isComplete = false;
  }
  cam.setAlpha(1);
  cam.alpha = 1;
}

/** Instant scene change — camera fades are how we get permanent black screens. */
export function goScene(scene: Phaser.Scene, key: string, data?: object) {
  revealCamera(scene);
  scene.scene.start(key, data);
}

/** Clear a stuck fade overlay if one is present (cheap no-op otherwise). */
export function ensureCameraClear(scene: Phaser.Scene) {
  const cam = scene.cameras.main;
  const fade = (cam as unknown as { fadeEffect?: { isRunning: boolean; isComplete: boolean; alpha: number } }).fadeEffect;
  if (fade && (fade.isRunning || fade.isComplete || fade.alpha > 0)) revealCamera(scene);
  else if (cam.alpha < 1) { cam.setAlpha(1); cam.alpha = 1; }
}
