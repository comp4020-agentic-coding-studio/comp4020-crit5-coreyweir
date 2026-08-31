// Cells, directions and turning. No maze, no game, no rendering — just the
// arithmetic of a square grid, so everything above it can be tested cheaply.

export type Dir = 0 | 1 | 2 | 3;

export const NORTH: Dir = 0;
export const EAST: Dir = 1;
export const SOUTH: Dir = 2;
export const WEST: Dir = 3;

export const DIRECTIONS: readonly Dir[] = [NORTH, EAST, SOUTH, WEST];

export interface Vec {
  readonly x: number;
  readonly y: number;
}

// y grows southward, matching how the maze array is laid out.
const DELTAS: Readonly<Record<Dir, Vec>> = {
  [NORTH]: { x: 0, y: -1 },
  [EAST]: { x: 1, y: 0 },
  [SOUTH]: { x: 0, y: 1 },
  [WEST]: { x: -1, y: 0 },
};

export function delta(dir: Dir): Vec {
  return DELTAS[dir];
}

export function turnLeft(dir: Dir): Dir {
  return ((dir + 3) % 4) as Dir;
}

export function turnRight(dir: Dir): Dir {
  return ((dir + 1) % 4) as Dir;
}

export function opposite(dir: Dir): Dir {
  return ((dir + 2) % 4) as Dir;
}

export function stepFrom(from: Vec, dir: Dir): Vec {
  const d = DELTAS[dir];
  return { x: from.x + d.x, y: from.y + d.y };
}

export function sameCell(a: Vec, b: Vec): boolean {
  return a.x === b.x && a.y === b.y;
}

/** The direction from `a` to an orthogonally adjacent `b`, or null. */
export function directionTo(a: Vec, b: Vec): Dir | null {
  for (const dir of DIRECTIONS) {
    const next = stepFrom(a, dir);
    if (next.x === b.x && next.y === b.y) return dir;
  }
  return null;
}

/** Manhattan distance, ignoring walls. */
export function manhattan(a: Vec, b: Vec): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
