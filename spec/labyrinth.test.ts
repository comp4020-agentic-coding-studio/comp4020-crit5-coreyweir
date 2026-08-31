// C5 — "A game". The mechanically checkable lines of the published spec:
//
//   - it can be lost: a wrong move is possible, and play ends somewhere —
//     a win, a loss or a finish
//   - it teaches itself: no instructions anywhere, on screen or off
//   - one rule of the game has a focused automated test
//
// The rest of the spec is judged by a person at the crit: whether the opening
// screen invites the first move, whether a stranger reaches an ending inside
// five minutes, and whether one change came from playing rather than reading.
// No test can hold those.
//
// These assert the contract — what the game must do — not how it is built, so
// they survive a change of approach or of stack.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

import {
  type Intent,
  LEVEL_COUNT,
  createLevel,
  respawn,
  tick,
} from "../src/game";
import { directionTo } from "../src/grid";
import {
  cellIndex,
  corridorLength,
  distancesFrom,
  neighbours,
} from "../src/maze";

describe("it can be lost, and play ends somewhere", () => {
  it("a wrong move is possible: doing nothing starves you out", () => {
    let game = createLevel(1, 7);
    for (let i = 0; i < 20_000 && game.status !== "gameOver"; i += 1) {
      game = game.status === "dying" ? respawn(game) : tick(game, 0.1, null);
    }
    expect(game.status).toBe("gameOver");
  });

  it("and play finishes: a legal route out ends the level", () => {
    // Walk the shortest path, the way a player who has understood the game
    // would. If this cannot finish, the level cannot be finished.
    let game = createLevel(1, 7);
    for (let i = 0; i < 5_000 && game.status === "playing"; i += 1) {
      const dist = distancesFrom(game.maze, game.exit);
      let target = null;
      let best = dist[cellIndex(game.maze, game.player)];
      for (const n of neighbours(game.maze, game.player)) {
        const d = dist[cellIndex(game.maze, n)];
        if (d >= 0 && d < best) {
          best = d;
          target = n;
        }
      }
      if (!target) break;
      const want = directionTo(game.player, target);
      const intent: Intent = game.facing === want ? "forward" : "turnRight";
      game = tick(game, 0.05, intent);
    }
    expect(game.status).toBe("levelComplete");
  });

  it("the run is finite — there is a last level, and leaving it wins", () => {
    const last = createLevel(LEVEL_COUNT, 3);
    const won = tick(
      { ...last, player: last.exit, playerCooldown: 0 },
      0.01,
      null,
    );
    expect(won.status).toBe("won");
  });

  it("every level it generates can actually be finished", () => {
    for (let level = 1; level <= LEVEL_COUNT; level += 1) {
      for (let seed = 1; seed <= 12; seed += 1) {
        const game = createLevel(level, seed * 31 + level);
        const dist = distancesFrom(game.maze, game.player);
        expect(
          dist[cellIndex(game.maze, game.exit)],
          `level ${level} seed ${seed}: the exit is walled off`,
        ).toBeGreaterThan(0);
        for (const item of [...game.food, ...game.swords]) {
          expect(
            dist[cellIndex(game.maze, item)],
            `level ${level} seed ${seed}: something is walled off`,
          ).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});

describe("the opening screen invites the first move", () => {
  // Whether it *feels* inviting is judged at the crit. What can be held here is
  // the floor beneath it: you are never spawned facing a wall, because a blank
  // rectangle invites nothing and there is no text allowed to rescue it.
  it("never starts you facing a wall", () => {
    for (let level = 1; level <= LEVEL_COUNT; level += 1) {
      for (let seed = 1; seed <= 25; seed += 1) {
        const game = createLevel(level, seed * 17 + level);
        expect(
          corridorLength(game.maze, game.player, game.facing),
          `level ${level} seed ${seed}: spawned facing a wall`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("faces you down the longest corridor there is", () => {
    for (let seed = 1; seed <= 25; seed += 1) {
      const game = createLevel(3, seed * 13);
      const chosen = corridorLength(game.maze, game.player, game.facing);
      for (const dir of [0, 1, 2, 3] as const) {
        expect(corridorLength(game.maze, game.player, dir)).toBeLessThanOrEqual(
          chosen,
        );
      }
    }
  });
});

describe("it teaches itself: no instructions anywhere", () => {
  // "No how-to-play modal, no instructions page, nothing in the README
  // standing in for either." Naming the game is explicitly allowed.
  const FORBIDDEN = [
    "how to play",
    "instructions",
    "tutorial",
    "arrow key",
    "wasd",
    "press w",
    "press the",
    "use the arrow",
    "objective:",
    "controls",
    "the goal is",
    "your goal is",
  ];

  const DIST = resolve("dist");

  function files(dir: string = DIST): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? files(path) : [path];
    });
  }

  const pages = files()
    .map((path) => relative(DIST, path).split(sep).join("/"))
    .filter((name) => name.endsWith(".html"))
    .map((name) => ({
      name,
      doc: new JSDOM(readFileSync(join(DIST, name), "utf8")).window.document,
    }));

  it("built at least one page", () => {
    expect(pages.length).toBeGreaterThan(0);
  });

  for (const { name, doc } of pages) {
    it(`${name} explains nothing on screen`, () => {
      const visible = (doc.body.textContent ?? "").toLowerCase();
      for (const phrase of FORBIDDEN) {
        expect(
          visible.includes(phrase),
          `"${phrase}" is on screen — the spec forbids instructions`,
        ).toBe(false);
      }
    });

    it(`${name} explains nothing to a scraper either`, () => {
      const description =
        doc
          .querySelector('meta[name="description"]')
          ?.getAttribute("content")
          ?.toLowerCase() ?? "";
      for (const phrase of FORBIDDEN) {
        expect(description.includes(phrase)).toBe(false);
      }
    });
  }

  it("the README does not stand in for an instructions page", () => {
    const readme = readFileSync(resolve("README.md"), "utf8").toLowerCase();
    for (const phrase of FORBIDDEN) {
      expect(
        readme.includes(phrase),
        `"${phrase}" is in the README — the spec closes that loophole`,
      ).toBe(false);
    }
  });
});
