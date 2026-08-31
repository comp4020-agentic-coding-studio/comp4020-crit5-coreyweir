import { describe, expect, it } from "vitest";
import { EAST, WEST } from "./grid";
import { type Maze, createRng, distancesFrom } from "./maze";
import { MEMORY_STEPS, decideMinotaur } from "./minotaur";

/** A straight open corridor of `length` cells, running east-west. */
function corridor(length: number): Maze {
  const maze: Maze = { width: length, height: 1, cells: new Uint8Array(length) };
  for (let x = 0; x < length - 1; x += 1) {
    maze.cells[x] |= 1 << EAST;
    maze.cells[x + 1] |= 1 << WEST;
  }
  return maze;
}

const rng = () => 0;

describe("the minotaur", () => {
  it("closes on you when it can see you and you are unarmed", () => {
    const maze = corridor(5);
    const decision = decideMinotaur(
      {
        maze,
        at: { x: 3, y: 0 },
        cameFrom: null,
        player: { x: 0, y: 0 },
        playerArmed: false,
        lastSeen: null,
        memory: 0,
      },
      rng,
    );
    expect(decision.mode).toBe("hunting");
    expect(decision.moveTo).toEqual({ x: 2, y: 0 });
  });

  // It carries one torch. Biasing generation toward long straights quietly
  // turned an unbounded sightline into a firing line down half the level, and
  // that is what made the corridors feel like a punishment rather than a place
  // to breathe.
  it("cannot pick you out from the far end of a long corridor", () => {
    const maze = corridor(9);
    const decision = decideMinotaur(
      {
        maze,
        at: { x: 8, y: 0 },
        cameFrom: null,
        player: { x: 0, y: 0 },
        playerArmed: false,
        lastSeen: null,
        memory: 0,
      },
      rng,
    );
    expect(decision.mode).toBe("patrolling");
  });

  // Two adjacent open cells always have line of sight, so a minotaur beside
  // you has already seen you. There is no such thing as blundering into
  // somebody in this maze, and a guard against it would be unreachable code.
  it("is already hunting by the time it is next to you", () => {
    const maze = corridor(3);
    const decision = decideMinotaur(
      {
        maze,
        at: { x: 1, y: 0 },
        cameFrom: { x: 0, y: 0 },
        player: { x: 2, y: 0 },
        playerArmed: false,
        lastSeen: null,
        memory: 0,
      },
      rng,
    );
    expect(decision.mode).toBe("hunting");
  });

  // Fleeing is what the sword buys you, and it is why an ambush is worth
  // setting up rather than just charging down the corridor.
  it("runs when it can see you are armed", () => {
    const maze = corridor(5);
    const decision = decideMinotaur(
      {
        maze,
        at: { x: 2, y: 0 },
        cameFrom: null,
        player: { x: 0, y: 0 },
        playerArmed: true,
        lastSeen: null,
        memory: 0,
      },
      rng,
    );
    expect(decision.mode).toBe("fleeing");
    expect(decision.moveTo).toEqual({ x: 3, y: 0 });
  });

  it("remembers where it last saw you after losing sight", () => {
    // Sight broken: two cells with no passage between them.
    const maze: Maze = { width: 3, height: 1, cells: new Uint8Array(3) };
    maze.cells[1] |= 1 << EAST;
    maze.cells[2] |= 1 << WEST;

    const decision = decideMinotaur(
      {
        maze,
        at: { x: 2, y: 0 },
        cameFrom: null,
        player: { x: 0, y: 0 },
        playerArmed: false,
        lastSeen: { x: 1, y: 0 },
        memory: MEMORY_STEPS,
      },
      rng,
    );
    expect(decision.mode).toBe("hunting");
    expect(decision.moveTo).toEqual({ x: 1, y: 0 });
    expect(decision.memory).toBe(MEMORY_STEPS - 1);
  });

  it("gives up and patrols once the memory runs out", () => {
    const maze: Maze = { width: 3, height: 1, cells: new Uint8Array(3) };
    maze.cells[1] |= 1 << EAST;
    maze.cells[2] |= 1 << WEST;

    const decision = decideMinotaur(
      {
        maze,
        at: { x: 2, y: 0 },
        cameFrom: null,
        player: { x: 0, y: 0 },
        playerArmed: false,
        lastSeen: { x: 1, y: 0 },
        memory: 0,
      },
      rng,
    );
    expect(decision.mode).toBe("patrolling");
  });

  it("never steps through a wall", () => {
    const maze = corridor(4);
    for (let x = 0; x < 4; x += 1) {
      const decision = decideMinotaur(
        {
          maze,
          at: { x, y: 0 },
          cameFrom: null,
          player: { x: 0, y: 0 },
          playerArmed: false,
          lastSeen: null,
          memory: 0,
        },
        rng,
      );
      expect(Math.abs(decision.moveTo.x - x)).toBeLessThanOrEqual(1);
      expect(decision.moveTo.y).toBe(0);
    }
  });

  it("paths around corners rather than greedily toward you", () => {
    // U-shape: (0,0)-(0,1)-(1,1)-(2,1)-(2,0). Straight line from (0,0) to
    // (2,0) is walled, so a greedy step east would be wrong.
    const maze: Maze = { width: 3, height: 2, cells: new Uint8Array(6) };
    const open = (ax: number, ay: number, bx: number, by: number) => {
      const ai = ay * 3 + ax;
      const bi = by * 3 + bx;
      const dir = bx > ax ? EAST : bx < ax ? WEST : by > ay ? 2 : 0;
      const back = bx > ax ? WEST : bx < ax ? EAST : by > ay ? 0 : 2;
      maze.cells[ai] |= 1 << dir;
      maze.cells[bi] |= 1 << back;
    };
    open(0, 0, 0, 1);
    open(0, 1, 1, 1);
    open(1, 1, 2, 1);
    open(2, 1, 2, 0);

    const dist = distancesFrom(maze, { x: 0, y: 0 });
    expect(dist[0 * 3 + 2]).toBe(4);

    const decision = decideMinotaur(
      {
        maze,
        at: { x: 2, y: 0 },
        cameFrom: null,
        player: { x: 0, y: 0 },
        playerArmed: false,
        lastSeen: { x: 0, y: 0 },
        memory: MEMORY_STEPS,
      },
      createRng(1),
    );
    expect(decision.moveTo).toEqual({ x: 2, y: 1 });
  });
});
