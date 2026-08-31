import { describe, expect, it } from "vitest";
import { EAST, WEST } from "./grid";
import { type Maze } from "./maze";
import {
  type GameState,
  ARMED_STEP_SECONDS,
  BASE_STEP_SECONDS,
  FOOD_SCORE,
  LEVEL_COUNT,
  MAX_DELTA,
  MEAT_SCORE,
  SWORD_SECONDS,
  createLevel,
  isArmed,
  playerStepSeconds,
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
  const base: GameState = {
    level: 2,
    maze: corridor(5),
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

  it("starving costs a life, resets you, and keeps your score", () => {
    const starved = tick(state({ hunger: 0.001, score: 70 }), 1, null);
    expect(starved.lives).toBe(2);
    expect(starved.player).toEqual({ x: 0, y: 0 });
    expect(starved.hunger).toBe(1);
    expect(starved.score).toBe(70);
    expect(starved.status).toBe("playing");
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
    expect(met.player).toEqual({ x: 0, y: 0 });
    expect(met.minotaur).not.toBeNull();
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
  // It is the tutorial, and it is made of level design: small enough to see the
  // whole loop in, and nothing hunting you while you learn it.
  it("is small, and nothing is hunting you", () => {
    const first = createLevel(1, 42);
    expect(first.maze.width).toBeLessThanOrEqual(3);
    expect(first.minotaur).toBeNull();
    expect(first.food.length).toBeGreaterThan(0);
  });

  it("puts the way out somewhere other than where you are standing", () => {
    for (let seed = 1; seed < 20; seed += 1) {
      const level = createLevel(1, seed);
      expect(level.exit).not.toEqual(level.player);
    }
  });
});
