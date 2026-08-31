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

/**
 * A room with no internal walls. Level 1 is one of these on purpose: the
 * teaching is done by the layout, and you cannot learn "eat, then leave" in a
 * maze that hides both the food and the way out behind a corner.
 */
export function openRoom(width: number, height: number): Maze {
  const maze: Maze = { width, height, cells: new Uint8Array(width * height) };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (const dir of DIRECTIONS) {
        if (inBounds(maze, stepFrom({ x, y }, dir))) {
          maze.cells[cellIndex(maze, { x, y })] |= 1 << dir;
        }
      }
    }
  }
  return maze;
}

/**
 * A maze drawn by hand.
 *
 * The layout is a `(2w+1) x (2h+1)` character grid: odd row/column pairs are
 * cells, the characters between them are the walls, and `#` is solid. Written
 * out it reads as the map it is, which is the whole reason level one is
 * authored — its shape *is* the tutorial, and a tutorial you cannot see while
 * editing is one you cannot tune.
 */
export function fromLayout(rows: readonly string[]): Maze {
  const height = (rows.length - 1) / 2;
  const width = (Math.max(...rows.map((r) => r.length)) - 1) / 2;
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    throw new Error("layout must be (2w+1) by (2h+1)");
  }

  const maze: Maze = { width, height, cells: new Uint8Array(width * height) };
  const at = (row: number, col: number): string => rows[row]?.[col] ?? "#";
  const solid = (x: number, y: number): boolean => at(2 * y + 1, 2 * x + 1) === "#";

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (solid(x, y)) continue;
      if (x + 1 < width && !solid(x + 1, y) && at(2 * y + 1, 2 * x + 2) !== "#") {
        carve(maze, { x, y }, 1);
      }
      if (y + 1 < height && !solid(x, y + 1) && at(2 * y + 2, 2 * x + 1) !== "#") {
        carve(maze, { x, y }, 2);
      }
    }
  }
  return maze;
}

/**
 * The shortest route from `a` to `b`, inclusive of both. Used to compose a
 * level rather than scatter it: the sword that teaches you what a sword does
 * has to be somewhere you were going to walk anyway.
 */
export function pathBetween(maze: Maze, a: Vec, b: Vec): Vec[] {
  const dist = distancesFrom(maze, b);
  if (!inBounds(maze, a) || dist[cellIndex(maze, a)] === -1) return [];

  const path: Vec[] = [a];
  let cursor = a;
  while (!(cursor.x === b.x && cursor.y === b.y)) {
    const d = dist[cellIndex(maze, cursor)];
    const step = neighbours(maze, cursor).find(
      (n) => dist[cellIndex(maze, n)] === d - 1,
    );
    if (!step) break;
    path.push(step);
    cursor = step;
  }
  return path;
}

/** How many cells you can see down `dir` from `from` before a wall stops you. */
export function corridorLength(maze: Maze, from: Vec, dir: Dir): number {
  let cursor = from;
  let seen = 0;
  while (isOpen(maze, cursor, dir)) {
    cursor = stepFrom(cursor, dir);
    seen += 1;
  }
  return seen;
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
 *
 * `straightness` (0..1) is the chance the carve keeps going the way it was
 * already going. An unbiased DFS turns at almost every cell, and in a game
 * where turning is the one thing you cannot do while moving, that reads as
 * constant fiddling rather than tension. Long runs are where the dread lives:
 * somewhere to be chased down, somewhere to see a torch coming.
 */
export function generateMaze(
  width: number,
  height: number,
  braid: number,
  rng: () => number,
  straightness = 0,
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
  const stack: { at: Vec; came: Dir | null }[] = [{ at: start, came: null }];
  visited[cellIndex(maze, start)] = 1;

  while (stack.length > 0) {
    const current = stack[stack.length - 1];
    const options = DIRECTIONS.filter((dir) => {
      const next = stepFrom(current.at, dir);
      return inBounds(maze, next) && !visited[cellIndex(maze, next)];
    });

    if (options.length === 0) {
      stack.pop();
      continue;
    }

    const ahead = current.came;
    const dir =
      ahead !== null && options.includes(ahead) && rng() < straightness
        ? ahead
        : options[Math.floor(rng() * options.length)];
    carve(maze, current.at, dir);
    const next = stepFrom(current.at, dir);
    visited[cellIndex(maze, next)] = 1;
    stack.push({ at: next, came: dir });
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
