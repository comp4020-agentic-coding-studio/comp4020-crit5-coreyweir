// Spec line 4: "a stranger can pick it up and reach an ending inside five
// minutes."
//
// Whether a stranger *understands* it is judged by the pod at the crit. What
// can be held here is the arithmetic underneath: a competent run has to fit in
// the budget with room to spare, because a stranger is slower than a solver
// that always knows the way. If a perfect player needs four minutes, a stranger
// has already lost.

import { describe, expect, it } from "vitest";

import {
  type GameState,
  type Intent,
  LEVEL_COUNT,
  createLevel,
  isArmed,
  nextLevel,
  respawn,
  tick,
} from "../src/game";
import {
  type Vec,
  directionTo,
  manhattan,
  sameCell,
  turnLeft,
  turnRight,
} from "../src/grid";
import { cellIndex, distancesFrom, neighbours } from "../src/maze";

const FRAME = 1 / 60;
const BUDGET_SECONDS = 5 * 60;

/** One intent that makes progress toward `target`, or null if we're on it. */
function intentToward(state: GameState, target: Vec): Intent | null {
  const distances = distancesFrom(state.maze, target);
  const here = distances[cellIndex(state.maze, state.player)];
  if (here === 0) return null;

  const open = neighbours(state.maze, state.player);
  const beast = state.minotaur;
  const dangerous = (cell: Vec): boolean =>
    beast !== null && !isArmed(state) && sameCell(cell, beast);

  // A competent player does not walk into the thing that eats them, and backs
  // off when it is on top of them. Without this the test would be demanding a
  // game beatable by someone with their eyes shut.
  let next: Vec | undefined;
  if (beast && !isArmed(state) && manhattan(state.player, beast) <= 1) {
    const away = distancesFrom(state.maze, beast);
    next = open.reduce<Vec | undefined>(
      (best, cell) =>
        best === undefined ||
        away[cellIndex(state.maze, cell)] > away[cellIndex(state.maze, best)]
          ? cell
          : best,
      undefined,
    );
  } else {
    next =
      open.find(
        (cell) =>
          distances[cellIndex(state.maze, cell)] === here - 1 &&
          !dangerous(cell),
      ) ?? open.find((cell) => distances[cellIndex(state.maze, cell)] === here - 1);
  }
  if (!next) return null;

  const want = directionTo(state.player, next);
  if (want === null) return null;
  if (want === state.facing) return "forward";
  return turnLeft(state.facing) === want ? "turnLeft" : "turnRight";
}

/** Eat when it's getting late, otherwise head for the way out. */
function chooseTarget(state: GameState): Vec {
  const pantry = [...state.meat, ...state.food];
  if (state.hunger < 0.55 && pantry.length > 0) {
    const distances = distancesFrom(state.maze, state.player);
    return pantry.reduce((best, cell) =>
      distances[cellIndex(state.maze, cell)] <
      distances[cellIndex(state.maze, best)]
        ? cell
        : best,
    );
  }
  return state.exit;
}

/** Play the whole game the way someone who already knows it would. */
function playThrough(seed: number): {
  seconds: number;
  status: string;
  reached: number;
} {
  let state = createLevel(1, seed);
  let seconds = 0;
  let guard = 0;

  while (seconds < BUDGET_SECONDS * 3 && guard < 400_000) {
    guard += 1;
    if (state.status === "won" || state.status === "gameOver") break;
    if (state.status === "dying") {
      state = respawn(state);
      continue;
    }
    if (state.status === "levelComplete") {
      state = nextLevel(state, seed + state.level);
      continue;
    }
    state = tick(state, FRAME, intentToward(state, chooseTarget(state)));
    seconds += FRAME;
  }

  return { seconds, status: state.status, reached: state.level };
}

describe("a stranger can reach an ending inside five minutes", () => {
  it("a competent run clears every level well inside the budget", () => {
    const runs = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => playThrough(seed * 101));
    const finished = runs.filter((run) => run.status === "won");

    // Reported so the number is visible when the balance changes, not just
    // pass/fail.
    const times = runs
      .map((r) => `${r.status}@L${r.reached} ${r.seconds.toFixed(0)}s`)
      .join(", ");

    console.log(`  pacing: ${times}`);

    // What the spec actually asks is that a stranger "reach an ending", and
    // spec line 2 is explicit that losing is one — so every run ending inside
    // the budget is the line under test, not every run being won. This used to
    // demand six wins from eight, which is a stricter thing than the contract
    // and had me tuning the game against a solver rather than against a hand.
    for (const run of runs) {
      expect(run.seconds, `runs: ${times}`).toBeLessThan(BUDGET_SECONDS * 0.6);
    }

    // Winnable, though: an ending you can only ever lose is a different game
    // from the one described, so hold a floor under it.
    expect(finished.length, `runs: ${times}`).toBeGreaterThanOrEqual(3);
  });

  it("level one is over in well under a minute", () => {
    for (let seed = 1; seed <= 6; seed += 1) {
      let state = createLevel(1, seed * 31);
      let seconds = 0;
      while (state.status === "playing" && seconds < 120) {
        state = tick(state, FRAME, intentToward(state, chooseTarget(state)));
        seconds += FRAME;
      }
      expect(state.status).toBe("levelComplete");
      expect(seconds).toBeLessThan(45);
    }
  });

  it("you cannot simply outrun hunger: the food has to be worth taking", () => {
    // If a straight sprint for the exit always worked, the food would be
    // scenery and the clock would carry no weight.
    let starved = 0;
    for (let seed = 1; seed <= 12; seed += 1) {
      let state = createLevel(LEVEL_COUNT, seed * 17);
      let seconds = 0;
      while (state.status === "playing" && seconds < 300) {
        state = tick(state, FRAME, intentToward(state, state.exit));
        seconds += FRAME;
      }
      if (state.status === "dying" || state.status === "gameOver") starved += 1;
    }
    expect(starved).toBeGreaterThan(0);
  });
});
