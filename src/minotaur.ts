// The minotaur's decision, as a pure function of what it can see.
//
// It is a tax on your route, not an assassin: a single same-speed pursuer can
// never corner you, and it isn't meant to. Its job is to force detours, and
// detours cost hunger.
//
// Sight is what drives it. Unarmed and seen, it hunts. Armed and seen, it runs
// — which is what makes an ambush possible: come at it from somewhere it has no
// line of sight to and you close the distance before it bolts.

import { type Vec, sameCell } from "./grid";
import {
  type Maze,
  cellIndex,
  distancesFrom,
  hasLineOfSight,
  neighbours,
} from "./maze";

export type MinotaurMode = "hunting" | "fleeing" | "patrolling";

/** How many steps it keeps heading for where it last saw you. */
export const MEMORY_STEPS = 6;

export interface MinotaurView {
  readonly maze: Maze;
  readonly at: Vec;
  /** Where it stepped from, so patrolling doesn't just oscillate. */
  readonly cameFrom: Vec | null;
  readonly player: Vec;
  readonly playerArmed: boolean;
  readonly lastSeen: Vec | null;
  readonly memory: number;
}

export interface MinotaurDecision {
  readonly mode: MinotaurMode;
  readonly moveTo: Vec;
  readonly lastSeen: Vec | null;
  readonly memory: number;
}

/** The open neighbour that minimises walking distance to `target`. */
function toward(maze: Maze, at: Vec, target: Vec): Vec {
  const dist = distancesFrom(maze, target);
  let best = at;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const n of neighbours(maze, at)) {
    const d = dist[cellIndex(maze, n)];
    if (d >= 0 && d < bestDist) {
      bestDist = d;
      best = n;
    }
  }
  return best;
}

/** The open neighbour that maximises walking distance from `target`. */
function awayFrom(maze: Maze, at: Vec, target: Vec): Vec {
  const dist = distancesFrom(maze, target);
  let best = at;
  let bestDist = Number.NEGATIVE_INFINITY;
  for (const n of neighbours(maze, at)) {
    const d = dist[cellIndex(maze, n)];
    if (d >= 0 && d > bestDist) {
      bestDist = d;
      best = n;
    }
  }
  return best;
}

function patrol(
  maze: Maze,
  at: Vec,
  cameFrom: Vec | null,
  rng: () => number,
): Vec {
  const open = neighbours(maze, at);
  if (open.length === 0) return at;
  // Prefer not to reverse, so it walks corridors instead of jittering — unless
  // it's in a dead end, where reversing is the only way out.
  const forward = cameFrom
    ? open.filter((n) => !sameCell(n, cameFrom))
    : open;
  const choices = forward.length > 0 ? forward : open;
  return choices[Math.floor(rng() * choices.length)];
}

export function decideMinotaur(
  view: MinotaurView,
  rng: () => number,
): MinotaurDecision {
  const { maze, at, cameFrom, player, playerArmed, lastSeen, memory } = view;
  const sees = hasLineOfSight(maze, at, player);

  if (sees && playerArmed) {
    return {
      mode: "fleeing",
      moveTo: awayFrom(maze, at, player),
      lastSeen: player,
      memory: 0,
    };
  }

  if (sees) {
    return {
      mode: "hunting",
      moveTo: toward(maze, at, player),
      lastSeen: player,
      memory: MEMORY_STEPS,
    };
  }

  // Lost sight, but still heading for where you were. Without this it forgets
  // you the instant you round a corner, which reads as broken rather than fair.
  if (!playerArmed && memory > 0 && lastSeen) {
    if (sameCell(at, lastSeen)) {
      return { mode: "patrolling", moveTo: patrol(maze, at, cameFrom, rng), lastSeen: null, memory: 0 };
    }
    return {
      mode: "hunting",
      moveTo: toward(maze, at, lastSeen),
      lastSeen,
      memory: memory - 1,
    };
  }

  return {
    mode: "patrolling",
    moveTo: patrol(maze, at, cameFrom, rng),
    lastSeen: null,
    memory: 0,
  };
}
