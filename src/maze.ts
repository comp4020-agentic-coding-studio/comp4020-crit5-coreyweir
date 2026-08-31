// Maze generation and queries. Deterministic given a seed, and pure: nothing
// in here reads a clock, the DOM, or Math.random.
//
// Generation is a randomised depth-first search, which produces a spanning
// tree — every cell reachable from every other, by construction, so a level is
// never unsolvable. `braid` then reopens a fraction of dead ends into loops.
// Braiding is the difficulty dial for the hunt: dead ends are what let you
// corner a fleeing minotaur, and loops are what let it run forever.

import {
  type Dir,
  type Vec,
  DIRECTIONS,
  opposite,
  stepFrom,
} from "./grid";

export interface Maze {
  readonly width: number;
  readonly height: number;
  /** One byte per cell; bit `dir` set means the passage that way is open. */
  readonly cells: Uint8Array;
}

/** mulberry32 — small, fast, and seeded, so a level can be reproduced. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function inBounds(maze: Maze, p: Vec): boolean {
  return p.x >= 0 && p.y >= 0 && p.x < maze.width && p.y < maze.height;
}

export function cellIndex(maze: Maze, p: Vec): number {
  return p.y * maze.width + p.x;
}

export function isOpen(maze: Maze, from: Vec, dir: Dir): boolean {
  if (!inBounds(maze, from)) return false;
  return (maze.cells[cellIndex(maze, from)] & (1 << dir)) !== 0;
}

function carve(maze: Maze, from: Vec, dir: Dir): void {
  const to = stepFrom(from, dir);
  if (!inBounds(maze, to)) return;
  maze.cells[cellIndex(maze, from)] |= 1 << dir;
  maze.cells[cellIndex(maze, to)] |= 1 << opposite(dir);
}

/** Open neighbours of `p` — the cells you can actually step to. */
export function neighbours(maze: Maze, p: Vec): Vec[] {
  const out: Vec[] = [];
  for (const dir of DIRECTIONS) {
    if (isOpen(maze, p, dir)) out.push(stepFrom(p, dir));
  }
  return out;
}

/**
 * Whether `b` is visible from `a`: same row or column, with every passage
 * between them open. This is what "sees you down a corridor" means, and it is
 * what triggers the minotaur hunting or fleeing.
 */
export function hasLineOfSight(maze: Maze, a: Vec, b: Vec): boolean {
  if (!inBounds(maze, a) || !inBounds(maze, b)) return false;
  if (a.x === b.x && a.y === b.y) return true;
  if (a.x !== b.x && a.y !== b.y) return false;

  const dir: Dir =
    a.x === b.x ? (b.y > a.y ? 2 : 0) : b.x > a.x ? 1 : 3;

  let cursor = a;
  // Bounded by the grid: at most width+height steps before we reach b.
  for (let i = 0; i < maze.width + maze.height; i += 1) {
    if (!isOpen(maze, cursor, dir)) return false;
    cursor = stepFrom(cursor, dir);
    if (cursor.x === b.x && cursor.y === b.y) return true;
  }
  return false;
}

/**
 * Breadth-first step distances from `from`, respecting walls. -1 where
 * unreachable. Used both to place the exit far from the start and to steer the
 * minotaur, so its pathing is genuinely shortest-path rather than greedy.
 */
export function distancesFrom(maze: Maze, from: Vec): Int32Array {
  const dist = new Int32Array(maze.width * maze.height).fill(-1);
  if (!inBounds(maze, from)) return dist;

  dist[cellIndex(maze, from)] = 0;
  let frontier: Vec[] = [from];

  while (frontier.length > 0) {
    const next: Vec[] = [];
    for (const cell of frontier) {
      const d = dist[cellIndex(maze, cell)];
      for (const n of neighbours(maze, cell)) {
        const i = cellIndex(maze, n);
        if (dist[i] === -1) {
          dist[i] = d + 1;
          next.push(n);
        }
      }
    }
    frontier = next;
  }
  return dist;
}

/** Cells with exactly one open side. */
export function deadEnds(maze: Maze): Vec[] {
  const out: Vec[] = [];
  for (let y = 0; y < maze.height; y += 1) {
    for (let x = 0; x < maze.width; x += 1) {
      const p = { x, y };
      if (neighbours(maze, p).length === 1) out.push(p);
    }
  }
  return out;
}

/**
 * `braid` is the fraction of dead ends (0..1) reopened into loops. 0 leaves a
 * perfect maze, all dead ends, easiest to corner something in.
 */
export function generateMaze(
  width: number,
  height: number,
  braid: number,
  rng: () => number,
): Maze {
  const maze: Maze = {
    width,
    height,
    cells: new Uint8Array(width * height),
  };

  // Randomised DFS with an explicit stack — no recursion depth limit to worry
  // about on a large maze.
  const visited = new Uint8Array(width * height);
  const start: Vec = { x: 0, y: 0 };
  const stack: Vec[] = [start];
  visited[cellIndex(maze, start)] = 1;

  while (stack.length > 0) {
    const current = stack[stack.length - 1];
    const options = DIRECTIONS.filter((dir) => {
      const next = stepFrom(current, dir);
      return inBounds(maze, next) && !visited[cellIndex(maze, next)];
    });

    if (options.length === 0) {
      stack.pop();
      continue;
    }

    const dir = options[Math.floor(rng() * options.length)];
    carve(maze, current, dir);
    const next = stepFrom(current, dir);
    visited[cellIndex(maze, next)] = 1;
    stack.push(next);
  }

  if (braid > 0) {
    for (const cell of deadEnds(maze)) {
      if (rng() >= braid) continue;
      const closed = DIRECTIONS.filter(
        (dir) =>
          !isOpen(maze, cell, dir) && inBounds(maze, stepFrom(cell, dir)),
      );
      if (closed.length === 0) continue;
      carve(maze, cell, closed[Math.floor(rng() * closed.length)]);
    }
  }

  return maze;
}
