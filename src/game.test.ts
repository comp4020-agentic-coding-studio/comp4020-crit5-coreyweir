import { describe, expect, it } from "vitest";
import { EAST, WEST, opposite } from "./grid";
import { type Maze, corridorLength, pathBetween } from "./maze";
import {
  type GameState,
  ARMED_STEP_SECONDS,
  BASE_STEP_SECONDS,
  FOOD_SCORE,
  LEVEL_COUNT,
  MAX_DELTA,
  MEAT_SCORE,
  SWORD_SECONDS,
  TURN_AROUND_SECONDS,
  TURN_SECONDS,
  createLevel,
  isArmed,
  playerStepSeconds,
  respawn,
  tick,
} from "./game";

function corridor(length: number): Maze {
  const maze: Maze = { width: length, height: 1, cells: new Uint8Array(length) };
  for (let x = 0; x < length - 1; x += 1) {
    maze.cells[x] |= 1 << EAST;
    maze.cells[x + 1] |= 1 << WEST;
  }
  return maze;
}

/** A five-cell corridor with the minotaur held still unless a test frees it. */
function state(overrides: Partial<GameState> = {}): GameState {
  const maze = corridor(5);
  const base: GameState = {
    level: 2,
    maze,
    start: { x: 0, y: 0 },
    player: { x: 0, y: 0 },
    facing: EAST,
    minotaur: null,
    minotaurFrom: null,
    minotaurLastSeen: null,
    minotaurMemory: 0,
    minotaurMode: "patrolling",
    hunger: 1,
    hungerRate: 0.1,
    lives: 3,
    score: 0,
    food: [],
    swords: [],
    meat: [],
    armedFor: 0,
    exit: { x: 4, y: 0 },
    seen: new Uint8Array(maze.width * maze.height),
    status: "playing",
    playerCooldown: 0,
    minotaurCooldown: 999,
    rngState: 1,
  };
  return { ...base, ...overrides };
}

describe("hunger", () => {
  it("drains with time", () => {
    let game = state();
    for (let i = 0; i < 10; i += 1) game = tick(game, 0.1, null);
    expect(game.hunger).toBeCloseTo(0.9);
  });

  // Per-second rather than per-step is deliberate: per-step drain makes
  // standing still free, and camping in a corner until the minotaur wanders
  // off becomes the dominant strategy.
  it("costs the same whether you move or stand still", () => {
    const still = tick(state(), 1, null);
    const moving = tick(state(), 1, "forward");
    expect(moving.hunger).toBeCloseTo(still.hunger);
    expect(moving.player).not.toEqual(still.player);
  });

  it("ignores the enormous delta a backgrounded tab returns", () => {
    const resumed = tick(state({ hunger: 1 }), 30, null);
    expect(resumed.hunger).toBeCloseTo(1 - 0.1 * MAX_DELTA);
    expect(resumed.status).toBe("playing");
  });

  // A death now has a beat to it. It used to teleport you home inside the
  // same frame, which meant the only evidence you had died was a missing pip.
  it("starving costs a life and stops the game where you fell", () => {
    const starved = tick(state({ hunger: 0.001, score: 70, player: { x: 1, y: 0 } }), 1, null);
    expect(starved.lives).toBe(2);
    expect(starved.status).toBe("dying");
    expect(starved.player).toEqual({ x: 1, y: 0 });
    expect(starved.score).toBe(70);
  });

  it("stays frozen while you are dying", () => {
    const starved = tick(state({ hunger: 0.001 }), 1, null);
    expect(tick(starved, 1, "forward")).toEqual(starved);
  });

  it("respawn puts you back at the start, fed, and keeps your score", () => {
    const back = respawn(
      tick(state({ hunger: 0.001, score: 70, player: { x: 1, y: 0 } }), 1, null),
    );
    expect(back.status).toBe("playing");
    expect(back.player).toEqual({ x: 0, y: 0 });
    expect(back.hunger).toBe(1);
    expect(back.score).toBe(70);
    expect(back.lives).toBe(2);
  });

  it("running out of lives ends the game", () => {
    const ended = tick(state({ hunger: 0.001, lives: 1 }), 1, null);
    expect(ended.status).toBe("gameOver");
  });
});

describe("what you pick up", () => {
  it("food restores hunger and scores", () => {
    const fed = tick(
      state({ hunger: 0.5, food: [{ x: 1, y: 0 }] }),
      0.01,
      "forward",
    );
    expect(fed.player).toEqual({ x: 1, y: 0 });
    expect(fed.hunger).toBeGreaterThan(0.5);
    expect(fed.score).toBe(FOOD_SCORE);
    expect(fed.food).toHaveLength(0);
  });

  it("hunger never overfills", () => {
    const fed = tick(state({ hunger: 1, food: [{ x: 1, y: 0 }] }), 0.01, "forward");
    expect(fed.hunger).toBeLessThanOrEqual(1);
  });

  it("a sword arms you, briefly, and speeds you up", () => {
    const armed = tick(state({ swords: [{ x: 1, y: 0 }] }), 0.01, "forward");
    expect(armed.armedFor).toBe(SWORD_SECONDS);
    expect(isArmed(armed)).toBe(true);
    expect(playerStepSeconds(armed)).toBe(ARMED_STEP_SECONDS);
    expect(playerStepSeconds(state())).toBe(BASE_STEP_SECONDS);
  });

  it("the sword runs out", () => {
    const expired = tick(state({ armedFor: 0.05 }), 0.06, null);
    expect(isArmed(expired)).toBe(false);
  });
});

// The rule the whole design hinges on, and the one the spec asks to be put
// under a focused test.
describe("meeting the minotaur", () => {
  it("unarmed costs a life", () => {
    const met = tick(
      state({ minotaur: { x: 1, y: 0 }, armedFor: 0 }),
      0.01,
      "forward",
    );
    expect(met.lives).toBe(2);
    expect(met.status).toBe("dying");
    // Still standing in the cell where it caught you, so you can see what did.
    expect(met.player).toEqual({ x: 1, y: 0 });
    expect(met.minotaur).not.toBeNull();
    expect(respawn(met).player).toEqual({ x: 0, y: 0 });
  });

  it("armed kills it, and it drops meat where it fell", () => {
    const met = tick(
      state({ minotaur: { x: 1, y: 0 }, armedFor: SWORD_SECONDS }),
      0.01,
      "forward",
    );
    expect(met.lives).toBe(3);
    expect(met.minotaur).toBeNull();
    expect(met.meat).toContainEqual({ x: 1, y: 0 });
  });

  it("the meat it drops is worth eating", () => {
    const killed = tick(
      state({ minotaur: { x: 1, y: 0 }, armedFor: SWORD_SECONDS, hunger: 0.4 }),
      0.01,
      "forward",
    );
    const eaten = tick(killed, 0.01, null);
    expect(eaten.hunger).toBeGreaterThan(0.4);
    expect(eaten.score).toBe(MEAT_SCORE);
  });

  // Two things swapping cells in a corridor have met. A grid that only compares
  // final positions lets you walk straight through the minotaur. Here the
  // minotaur is in the end cell, so its only move is into the one you vacate.
  it("catches a swap, not just a shared cell", () => {
    const swapped = tick(
      state({
        player: { x: 3, y: 0 },
        minotaur: { x: 4, y: 0 },
        minotaurCooldown: 0,
      }),
      0.01,
      "forward",
    );
    expect(swapped.lives).toBe(2);
  });

  // Found by a failing test: resolving contact only at the end of the tick gave
  // the minotaur a free step out of the way, so you could walk through it.
  it("does not let it dodge out of the way as you step onto it", () => {
    const met = tick(
      state({ minotaur: { x: 1, y: 0 }, minotaurCooldown: 0 }),
      0.01,
      "forward",
    );
    expect(met.lives).toBe(2);
  });
});

describe("walls and endings", () => {
  it("you cannot walk through a wall", () => {
    const blocked = tick(state({ player: { x: 4, y: 0 } }), 0.01, "forward");
    expect(blocked.player).toEqual({ x: 4, y: 0 });
  });

  it("reaching the exit finishes the level", () => {
    const out = tick(state({ player: { x: 3, y: 0 } }), 0.01, "forward");
    expect(out.status).toBe("levelComplete");
  });

  it("reaching the exit on the last level wins", () => {
    const out = tick(
      state({ player: { x: 3, y: 0 }, level: LEVEL_COUNT }),
      0.01,
      "forward",
    );
    expect(out.status).toBe("won");
  });

  it("a finished game ignores further input", () => {
    const over = tick(state({ hunger: 0.001, lives: 1 }), 1, null);
    expect(tick(over, 1, "forward")).toEqual(over);
  });
});

describe("the first level", () => {
  // It is the tutorial, and it is made of level design: a corridor rather than
  // a hall, nothing hunting you, and every lesson reachable on foot.
  it("teaches without anything hunting you", () => {
    const first = createLevel(1, 42);
    expect(first.minotaur).toBeNull();
    expect(first.swords).toHaveLength(0);
    expect(first.food.length).toBeGreaterThan(0);
  });

  it("opens on a corridor with somewhere to go", () => {
    const first = createLevel(1, 42);
    expect(corridorLength(first.maze, first.player, first.facing)).toBeGreaterThanOrEqual(3);
  });

  it("makes you turn at least once to reach the way out", () => {
    const first = createLevel(1, 42);
    const route = pathBetween(first.maze, first.player, first.exit);
    expect(route.length).toBeGreaterThan(3);
    const turns = route
      .slice(1)
      .map((cell, i) => `${cell.x - route[i].x},${cell.y - route[i].y}`)
      .filter((step, i, all) => i > 0 && step !== all[i - 1]);
    expect(turns.length).toBeGreaterThan(0);
  });

  it("puts everything worth eating somewhere you can walk to", () => {
    const first = createLevel(1, 42);
    for (const cell of [...first.food, first.exit]) {
      expect(pathBetween(first.maze, first.player, cell).length).toBeGreaterThan(0);
    }
  });

  it("puts the way out somewhere other than where you are standing", () => {
    for (let seed = 1; seed < 20; seed += 1) {
      const level = createLevel(1, seed);
      expect(level.exit).not.toEqual(level.player);
    }
  });
});

describe("turning around", () => {
  it("reverses you in one move", () => {
    const start = createLevel(1, 5);
    const spun = tick(start, 1 / 60, "turnAround");
    expect(spun.facing).toBe(opposite(start.facing));
  });

  it("costs more than one turn and less than two, or nobody would use it", () => {
    expect(TURN_AROUND_SECONDS).toBeGreaterThan(TURN_SECONDS);
    expect(TURN_AROUND_SECONDS).toBeLessThan(TURN_SECONDS * 2);
  });

  it("lands on the same heading as two turns the same way", () => {
    const start = createLevel(1, 9);
    const spun = tick(start, 1 / 60, "turnAround");
    // A single tick cannot span a turn: dt is clamped to MAX_DELTA, which is
    // shorter than TURN_SECONDS. Wait the cooldown out the way the game does.
    let twice = tick(start, 1 / 60, "turnRight");
    while (twice.playerCooldown > 0) twice = tick(twice, MAX_DELTA, null);
    twice = tick(twice, 1 / 60, "turnRight");
    expect(spun.facing).toBe(twice.facing);
  });
});

describe("the move in progress", () => {
  // The renderer draws the space between cells from these three fields. If
  // moveFor is ever zero mid-move it divides by nothing and the step snaps,
  // which is the exact lurch this was written to remove.
  it("records where a step came from, and how long it takes", () => {
    const start = createLevel(1, 3);
    const stepped = tick(start, 1 / 60, "forward");
    expect(stepped.playerFrom).toEqual(start.player);
    expect(stepped.player).not.toEqual(start.player);
    expect(stepped.moveFor).toBeGreaterThan(0);
    expect(stepped.playerCooldown).toBeCloseTo(stepped.moveFor, 5);
  });

  it("records where a turn came from too", () => {
    const start = createLevel(1, 3);
    const turned = tick(start, 1 / 60, "turnLeft");
    expect(turned.facingFrom).toBe(start.facing);
    expect(turned.facing).not.toBe(start.facing);
    expect(turned.moveFor).toBeCloseTo(TURN_SECONDS, 5);
  });

  it("starts a level settled, so the first frame has nothing to interpolate", () => {
    const start = createLevel(2, 11);
    expect(start.playerFrom).toEqual(start.player);
    expect(start.facingFrom).toBe(start.facing);
    expect(start.moveFor).toBe(0);
  });
});
