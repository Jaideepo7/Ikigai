export const DIRECTIONS = ['up', 'down', 'left', 'right', 'up-left', 'up-right', 'down-left', 'down-right'] as const;
export type Dir = typeof DIRECTIONS[number];

export function movementDirection(x: number, y: number, previous: Dir): Dir {
  if (!x && !y) return previous;
  if (!x) return y < 0 ? 'up' : 'down';
  if (!y) return x < 0 ? 'left' : 'right';
  return `${y < 0 ? 'up' : 'down'}-${x < 0 ? 'left' : 'right'}`;
}

// Rear-facing art for travel away from the camera; the three-quarter side
// view reads naturally for diagonals toward it. Left views mirror right art.
export function movementView(dir: Dir): 'up' | 'down' | 'side' {
  return dir.startsWith('up') ? 'up' : dir === 'down' ? 'down' : 'side';
}

// Character folders are one-based; runtime character IDs are zero-based.
export const DETAILED_WALKERS = [4, 13] as const;
export function hasDetailedWalk(character: number) {
  return DETAILED_WALKERS.some(id => id === character);
}
