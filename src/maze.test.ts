import { describe, expect, it } from "vitest";
import { EAST, NORTH, SOUTH, WEST, turnLeft, turnRight } from "./grid";
import {
  type Maze,
  createRng,
  deadEnds,
  distancesFrom,
  generateMaze,
  hasLineOfSight,
  isOpen,
  neighbours,
} from "./maze";

function reachableCount(maze: Maze): number {
  const dist = distancesFrom(maze, { x: 0, y: 0 });
  return dist.reduce((n, d) => (d >= 0 ? n + 1 : n), 0);
}

describe("turning", () => {
  it("four lefts is where you started", () => {
    expect(turnLeft(turnLeft(turnLeft(turnLeft(NORTH))))).toBe(NORTH);
  });

  it("left then right is a no-op", () => {
    for (const dir of [NORTH, EAST, SOUTH, WEST]) {
      expect(turnRight(turnLeft(dir))).toBe(dir);
    }
  });
});

describe("generated mazes", () => {
  // Solvability is the property that matters: a level you cannot finish is
  // worse than a hard one. Spanning-tree generation guarantees it by
  // construction, so assert it over many seeds rather than trusting the walk.
  it("are always fully connected, at every size and braid", () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const size = 3 + (seed % 9);
      const braid = (seed % 5) * 0.1;
      const maze = generateMaze(size, size, braid, createRng(seed));
      expect(
        reachableCount(maze),
        `seed ${seed} (${size}x${size}, braid ${braid}) left cells unreachable`,
      ).toBe(size * size);
    }
  });

  it("are reproducible from a seed", () => {
    const a = generateMaze(8, 8, 0.2, createRng(99));
    const b = generateMaze(8, 8, 0.2, createRng(99));
    expect(Array.from(a.cells)).toEqual(Array.from(b.cells));
  });

  it("differ between seeds", () => {
    const a = generateMaze(8, 8, 0, createRng(1));
    const b = generateMaze(8, 8, 0, createRng(2));
    expect(Array.from(a.cells)).not.toEqual(Array.from(b.cells));
  });

  it("never open a passage through the outer wall", () => {
    const maze = generateMaze(6, 6, 0.4, createRng(7));
    for (let x = 0; x < 6; x += 1) {
      expect(isOpen(maze, { x, y: 0 }, NORTH)).toBe(false);
      expect(isOpen(maze, { x, y: 5 }, SOUTH)).toBe(false);
    }
    for (let y = 0; y < 6; y += 1) {
      expect(isOpen(maze, { x: 0, y }, WEST)).toBe(false);
      expect(isOpen(maze, { x: 5, y }, EAST)).toBe(false);
    }
  });

  it("keep passages mutual — if you can walk in, you can walk back", () => {
    const maze = generateMaze(7, 7, 0.3, createRng(11));
    for (let y = 0; y < 7; y += 1) {
      for (let x = 0; x < 7; x += 1) {
        for (const n of neighbours(maze, { x, y })) {
          expect(neighbours(maze, n)).toContainEqual({ x, y });
        }
      }
    }
  });

  // Braiding is the difficulty dial for the hunt: dead ends are what let you
  // corner a fleeing minotaur.
  it("braiding removes dead ends", () => {
    const perfect = generateMaze(11, 11, 0, createRng(5));
    const braided = generateMaze(11, 11, 0.9, createRng(5));
    expect(deadEnds(braided).length).toBeLessThan(deadEnds(perfect).length);
  });
});

describe("line of sight", () => {
  it("sees down an open corridor and not through a wall", () => {
    // A 3x1 corridor with the far passage closed:  [0] - [1] | [2]
    const maze: Maze = { width: 3, height: 1, cells: new Uint8Array(3) };
    maze.cells[0] |= 1 << EAST;
    maze.cells[1] |= 1 << WEST;

    expect(hasLineOfSight(maze, { x: 0, y: 0 }, { x: 1, y: 0 })).toBe(true);
    expect(hasLineOfSight(maze, { x: 0, y: 0 }, { x: 2, y: 0 })).toBe(false);
  });

  it("does not see diagonally", () => {
    const maze = generateMaze(5, 5, 1, createRng(3));
    expect(hasLineOfSight(maze, { x: 0, y: 0 }, { x: 1, y: 1 })).toBe(false);
  });

  it("is symmetric", () => {
    const maze = generateMaze(9, 9, 0.3, createRng(21));
    for (let y = 0; y < 9; y += 1) {
      for (let x = 0; x < 9; x += 1) {
        const a = { x: 0, y: 0 };
        const b = { x, y };
        expect(hasLineOfSight(maze, a, b)).toBe(hasLineOfSight(maze, b, a));
      }
    }
  });
});
