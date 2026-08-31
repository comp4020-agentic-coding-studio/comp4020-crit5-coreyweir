// The rules, as a pure state machine.
//
// No DOM, no `three`, no clock reads: time arrives as a delta argument and
// randomness arrives as seeded state. That is what makes every rule in here
// testable without a browser.

import {
  type Dir,
  type Vec,
  DIRECTIONS,
  NORTH,
  opposite,
  sameCell,
  stepFrom,
  turnLeft,
  turnRight,
} from "./grid";
import {
  type Maze,
  cellIndex,
  corridorLength,
  createRng,
  distancesFrom,
  fromLayout,
  generateMaze,
  isOpen,
  pathBetween,
} from "./maze";
import { type MinotaurMode, decideMinotaur } from "./minotaur";

export type Intent = "forward" | "turnLeft" | "turnRight" | "turnAround";
export type Status =
  | "playing"
  /** Killed, but still standing where it happened, so you can see why. */
  | "dying"
  | "levelComplete"
  | "gameOver"
  | "won";

// Tuning. These are the numbers that get changed by playing, not by reasoning.
export const BASE_STEP_SECONDS = 0.24;
export const ARMED_STEP_SECONDS = 0.145;
export const TURN_SECONDS = 0.16;
/** Slower than a quarter turn but faster than two, so it stays worth using. */
export const TURN_AROUND_SECONDS = 0.26;
/**
 * Deliberately slower than your 0.2. At equal speed a pursuer that hunts on
 * sight is not a threat, it is an execution: you cannot break line of sight by
 * running, so every sighting costs a life and a perfect player still died on
 * level two. Slower means it is escapable in a straight line and dangerous
 * when you hesitate, turn badly, or get cornered — which is where the tension
 * should live.
 */
export const MINOTAUR_STEP_SECONDS = 0.4;
export const SWORD_SECONDS = 8;
export const FOOD_RESTORE = 0.3;
export const MEAT_RESTORE = 0.55;
export const FOOD_SCORE = 10;
export const MEAT_SCORE = 50;
export const LEVEL_SCORE = 25;
export const STARTING_LIVES = 3;
export const LEVEL_COUNT = 6;
/** Long enough to read what killed you, short enough not to be a punishment. */
export const DYING_SECONDS = 1.5;

/**
 * A backgrounded tab returns one enormous delta on its first frame back, which
 * would drain a full hunger bar instantly through no fault of the player.
 */
export const MAX_DELTA = 0.1;

export interface GameState {
  readonly level: number;
  readonly maze: Maze;
  readonly start: Vec;
  readonly player: Vec;
  readonly facing: Dir;
  /**
   * Where the move in progress started, and how long it takes.
   *
   * The rules are still discrete — you are always in exactly one cell facing
   * exactly one way — but the renderer needs the departure point to draw the
   * space between. Without it the only thing it can do is chase the destination
   * with an easing curve, which accelerates and then crawls, and reads as a
   * lurch on every single step.
   */
  readonly playerFrom: Vec;
  readonly facingFrom: Dir;
  readonly moveFor: number;
  readonly minotaur: Vec | null;
  readonly minotaurFrom: Vec | null;
  readonly minotaurLastSeen: Vec | null;
  readonly minotaurMemory: number;
  readonly minotaurMode: MinotaurMode;
  readonly hunger: number;
  readonly hungerRate: number;
  readonly lives: number;
  readonly score: number;
  readonly food: readonly Vec[];
  readonly swords: readonly Vec[];
  readonly meat: readonly Vec[];
  readonly armedFor: number;
  readonly exit: Vec;
  /**
   * One byte per cell, set once you have stood in it or seen down it. This is
   * Ariadne's thread: the map is drawn by walking, so the maze is still
   * unknown ahead of you and merely *remembered* behind you.
   */
  readonly seen: Uint8Array;
  readonly status: Status;
  readonly playerCooldown: number;
  readonly minotaurCooldown: number;
  readonly rngState: number;
}

export interface LevelConfig {
  readonly width: number;
  readonly height: number;
  readonly braid: number;
  /** How strongly generation prefers to keep carving in a straight line. */
  readonly straightness: number;
  readonly hungerRate: number;
  readonly food: number;
  readonly swords: number;
  readonly minotaur: boolean;
  /** Drawn by hand rather than generated. See `fromLayout`. */
  readonly layout?: readonly string[];
  readonly start?: Vec;
  readonly exit?: Vec;
  readonly foodAt?: readonly Vec[];
  /**
   * Compose the level instead of scattering it: the sword goes on the route
   * you were already walking and the minotaur guards the far end of it.
   */
  readonly teach?: boolean;
}

/**
 * Level one, drawn rather than generated.
 *
 * A corridor with one forced turn, one thing to eat on the way and one worth
 * stepping aside for. It used to be an open five-by-five room, which taught
 * the loop but taught it in a hall — and a hall is not what the game is. You
 * learn "walk, turn, eat, leave" in the shape you will be playing in.
 */
const LEVEL_ONE = [
  "###############",
  "#######       #",
  "####### #######",
  "#       #######",
  "### ###########",
  "###   #########",
  "###############",
];

export function levelConfig(level: number): LevelConfig {
  if (level <= 1) {
    return {
      width: 7,
      height: 3,
      braid: 0,
      straightness: 0,
      hungerRate: 0.01,
      food: 2,
      swords: 0,
      minotaur: false,
      layout: LEVEL_ONE,
      start: { x: 0, y: 1 },
      exit: { x: 6, y: 0 },
      foodAt: [
        { x: 2, y: 1 },
        { x: 2, y: 2 },
      ],
    };
  }

  // Level two is the second half of the tutorial and it teaches the sword.
  // Small enough that you cannot avoid the lesson, looped enough that you
  // cannot be cornered while learning it.
  if (level === 2) {
    return {
      width: 5,
      height: 5,
      braid: 0.7,
      straightness: 0.85,
      hungerRate: 0.014,
      food: 3,
      swords: 1,
      minotaur: true,
      teach: true,
    };
  }

  // Room to manoeuvre: a 5x5 with something hunting you is a cupboard.
  const size = Math.min(5 + (level - 2) * 2, 13);
  return {
    width: size,
    height: size,
    // Braid runs DOWN, not up, and that inversion was the fix for level two.
    // A perfect maze is all dead ends, and a dead end with something hunting
    // you in it is not a challenge, it is a trap you cannot read in advance.
    // Loops first, so fleeing is a skill you can exercise; dead ends later,
    // once you have a sword and they are where you corner the thing instead.
    braid: Math.max(0.95 - (level - 3) * 0.2, 0.35),
    // Turning is the one thing you cannot do while moving, so a maze that
    // turns every cell is a maze you spend fiddling instead of dreading.
    straightness: 0.78,
    hungerRate: 0.014 + (level - 3) * 0.003,
    food: 2 + level,
    swords: 1 + Math.floor((level - 1) / 3),
    minotaur: true,
  };
}

/**
 * Which way to face on arrival: down the longest open corridor.
 *
 * The opening screen has to invite the first move, and the default of "face
 * north" spawns you nose-to-nose with the boundary wall — a blank brown
 * rectangle, which invites nothing. Looking down a corridor with somewhere to
 * go in it is the whole of the game's first instruction, and it isn't words.
 */
export function openingFacing(maze: Maze, from: Vec, toward?: Vec): Dir {
  let best: Dir = NORTH;
  let bestLength = -1;
  let bestPull = -Infinity;
  for (const dir of DIRECTIONS) {
    const length = corridorLength(maze, from, dir);
    if (length <= 0) continue;
    // Among equally long corridors, look the way the exit is: in an open room
    // that is the difference between the way out being in shot and being
    // somewhere behind your shoulder.
    const step = stepFrom(from, dir);
    const pull = toward
      ? -(Math.abs(step.x - toward.x) + Math.abs(step.y - toward.y))
      : 0;
    if (length > bestLength || (length === bestLength && pull > bestPull)) {
      bestLength = length;
      bestPull = pull;
      best = dir;
    }
  }
  return best;
}

/**
 * Where to drop the player: the cell you can see furthest from.
 *
 * Cell (0,0) is a corner, and a corner of a generated maze is nearly always a
 * stub with a wall a step away. The rule that the opening screen has to invite
 * the first move applies to every level, not just the authored one, and the
 * cheapest way to honour it is to start where there is something to look at.
 */
export function bestStart(maze: Maze): Vec {
  let best: Vec = { x: 0, y: 0 };
  let bestView = -1;
  for (let y = 0; y < maze.height; y += 1) {
    for (let x = 0; x < maze.width; x += 1) {
      let view = 0;
      for (const dir of DIRECTIONS) {
        view = Math.max(view, corridorLength(maze, { x, y }, dir));
      }
      if (view > bestView) {
        bestView = view;
        best = { x, y };
      }
    }
  }
  return best;
}

function farthestFrom(maze: Maze, from: Vec): Vec {
  const dist = distancesFrom(maze, from);
  let best = from;
  let bestDist = -1;
  for (let y = 0; y < maze.height; y += 1) {
    for (let x = 0; x < maze.width; x += 1) {
      const d = dist[y * maze.width + x];
      if (d > bestDist) {
        bestDist = d;
        best = { x, y };
      }
    }
  }
  return best;
}

function pickCells(
  maze: Maze,
  count: number,
  taken: Vec[],
  rng: () => number,
): Vec[] {
  const free: Vec[] = [];
  for (let y = 0; y < maze.height; y += 1) {
    for (let x = 0; x < maze.width; x += 1) {
      const p = { x, y };
      if (!taken.some((t) => sameCell(t, p))) free.push(p);
    }
  }
  const out: Vec[] = [];
  for (let i = 0; i < count && free.length > 0; i += 1) {
    out.push(free.splice(Math.floor(rng() * free.length), 1)[0]);
  }
  return out;
}

export function createLevel(
  level: number,
  seed: number,
  lives: number = STARTING_LIVES,
  score: number = 0,
): GameState {
  const config = levelConfig(level);
  const rng = createRng(seed);
  const maze = config.layout
    ? fromLayout(config.layout)
    : generateMaze(
        config.width,
        config.height,
        config.braid,
        rng,
        config.straightness,
      );

  const start: Vec = config.start ?? bestStart(maze);
  const exit = config.exit ?? farthestFrom(maze, start);
  const taken: Vec[] = [start, exit];

  // The teaching levels are composed, not scattered. Level two has to put a
  // sword in your hand *before* you meet the thing it works on, or the lesson
  // is "you died" rather than "that is what the glowing blade was for".
  const route = config.teach ? pathBetween(maze, start, exit) : [];
  const placed = route.length >= 4 ? route[Math.floor(route.length / 2)] : null;

  const swords = placed
    ? [placed]
    : pickCells(maze, config.swords, taken, rng);
  taken.push(...swords);

  const food = config.foodAt
    ? config.foodAt.map((c) => ({ ...c }))
    : pickCells(maze, config.food, taken, rng);
  taken.push(...food);

  let minotaur: Vec | null = null;
  if (config.minotaur && placed) {
    minotaur = route[route.length - 2] ?? exit;
  } else if (config.minotaur) {
    // Far enough away that it isn't standing on you at the first frame.
    const dist = distancesFrom(maze, start);
    const candidates: Vec[] = [];
    for (let y = 0; y < maze.height; y += 1) {
      for (let x = 0; x < maze.width; x += 1) {
        const d = dist[y * maze.width + x];
        if (d >= Math.max(3, Math.floor((config.width + config.height) / 2))) {
          candidates.push({ x, y });
        }
      }
    }
    minotaur =
      candidates.length > 0
        ? candidates[Math.floor(rng() * candidates.length)]
        : farthestFrom(maze, start);
  }

  return {
    level,
    maze,
    start,
    player: start,
    facing: openingFacing(maze, start, exit),
    playerFrom: start,
    facingFrom: openingFacing(maze, start, exit),
    moveFor: 0,
    minotaur,
    minotaurFrom: null,
    minotaurLastSeen: null,
    minotaurMemory: 0,
    minotaurMode: "patrolling",
    hunger: 1,
    hungerRate: config.hungerRate,
    lives,
    score,
    food,
    swords,
    meat: [],
    armedFor: 0,
    exit,
    status: "playing",
    seen: markSeen(maze, new Uint8Array(maze.width * maze.height), start),
    playerCooldown: 0,
    minotaurCooldown: MINOTAUR_STEP_SECONDS,
    rngState: seed,
  };
}

/**
 * Mark where you are and everything you can see from it.
 *
 * Sight, not proximity: a cell counts as seen when it is down an open corridor
 * from you, which is exactly the rule the minotaur uses to spot you. Same
 * information, both ways.
 */
export function markSeen(maze: Maze, seen: Uint8Array, at: Vec): Uint8Array {
  const out = Uint8Array.from(seen);
  out[cellIndex(maze, at)] = 1;
  for (const dir of DIRECTIONS) {
    let cursor = at;
    while (isOpen(maze, cursor, dir)) {
      cursor = stepFrom(cursor, dir);
      out[cellIndex(maze, cursor)] = 1;
    }
  }
  return out;
}

export function isArmed(state: GameState): boolean {
  return state.armedFor > 0;
}

export function playerStepSeconds(state: GameState): number {
  return isArmed(state) ? ARMED_STEP_SECONDS : BASE_STEP_SECONDS;
}

/**
 * Losing a life stops the game where it stands. It used to teleport you back
 * to the start inside the same frame, and a death you cannot see is a death
 * you cannot learn from — you were simply somewhere else, with one fewer pip.
 * The reset waits for `respawn`.
 */
function loseLife(state: GameState): GameState {
  const lives = state.lives - 1;
  if (lives <= 0) {
    return { ...state, lives: 0, hunger: 0, status: "gameOver" };
  }
  return { ...state, lives, status: "dying" };
}

/** Back on your feet at the start of the level. The score is never reset. */
export function respawn(state: GameState): GameState {
  const facing = openingFacing(state.maze, state.start, state.exit);
  return {
    ...state,
    status: "playing",
    hunger: 1,
    armedFor: 0,
    player: state.start,
    facing,
    playerFrom: state.start,
    facingFrom: facing,
    moveFor: 0,
    playerCooldown: 0,
    minotaur: state.minotaur ? farthestFrom(state.maze, state.start) : null,
    minotaurFrom: null,
    minotaurLastSeen: null,
    minotaurMemory: 0,
    minotaurMode: "patrolling",
    minotaurCooldown: MINOTAUR_STEP_SECONDS,
  };
}

function collect(state: GameState): GameState {
  let { hunger, score, armedFor } = state;
  const at = state.player;

  const food = state.food.filter((f) => !sameCell(f, at));
  if (food.length !== state.food.length) {
    hunger = Math.min(1, hunger + FOOD_RESTORE);
    score += FOOD_SCORE;
  }

  const meat = state.meat.filter((m) => !sameCell(m, at));
  if (meat.length !== state.meat.length) {
    hunger = Math.min(1, hunger + MEAT_RESTORE);
    score += MEAT_SCORE;
  }

  const swords = state.swords.filter((s) => !sameCell(s, at));
  if (swords.length !== state.swords.length) {
    armedFor = SWORD_SECONDS;
  }

  return { ...state, food, meat, swords, hunger, score, armedFor };
}

/**
 * Contact is same-cell *or* a swap. Two things moving through each other in a
 * corridor have met, and a grid that only compares final cells lets you walk
 * straight past the minotaur.
 */
function hasMet(
  state: GameState,
  playerWas: Vec,
  minotaurWas: Vec | null,
): boolean {
  if (!state.minotaur || minotaurWas === null) return false;
  return (
    sameCell(state.player, state.minotaur) ||
    (sameCell(state.player, minotaurWas) && sameCell(state.minotaur, playerWas))
  );
}

/**
 * THE rule the whole design hinges on. Armed, you kill it and it drops meat
 * where it fell; unarmed, it costs you a life.
 */
function applyContact(state: GameState): GameState {
  if (!state.minotaur) return state;
  if (isArmed(state)) {
    return {
      ...state,
      minotaur: null,
      minotaurFrom: null,
      minotaurLastSeen: null,
      minotaurMemory: 0,
      meat: [...state.meat, state.minotaur],
    };
  }
  return loseLife(state);
}

export function tick(
  state: GameState,
  deltaSeconds: number,
  intent: Intent | null,
): GameState {
  if (state.status !== "playing") return state;

  const dt = Math.max(0, Math.min(deltaSeconds, MAX_DELTA));
  let next: GameState = {
    ...state,
    hunger: Math.max(0, state.hunger - state.hungerRate * dt),
    armedFor: Math.max(0, state.armedFor - dt),
    playerCooldown: Math.max(0, state.playerCooldown - dt),
    minotaurCooldown: Math.max(0, state.minotaurCooldown - dt),
    rngState: (Math.imul(state.rngState, 1664525) + 1013904223) >>> 0,
  };

  const playerWas = next.player;
  const minotaurWas = next.minotaur;

  if (intent && next.playerCooldown <= 0) {
    const began = { playerFrom: next.player, facingFrom: next.facing };
    if (intent === "turnLeft") {
      next = {
        ...next,
        ...began,
        facing: turnLeft(next.facing),
        playerCooldown: TURN_SECONDS,
        moveFor: TURN_SECONDS,
      };
    } else if (intent === "turnRight") {
      next = {
        ...next,
        ...began,
        facing: turnRight(next.facing),
        playerCooldown: TURN_SECONDS,
        moveFor: TURN_SECONDS,
      };
    } else if (intent === "turnAround") {
      next = {
        ...next,
        ...began,
        facing: opposite(next.facing),
        playerCooldown: TURN_AROUND_SECONDS,
        moveFor: TURN_AROUND_SECONDS,
      };
    } else if (isOpen(next.maze, next.player, next.facing)) {
      const seconds = playerStepSeconds(next);
      next = {
        ...next,
        ...began,
        player: stepFrom(next.player, next.facing),
        playerCooldown: seconds,
        moveFor: seconds,
      };
    }
  }

  if (next.player !== playerWas) {
    next = { ...next, seen: markSeen(next.maze, next.seen, next.player) };
  }

  next = collect(next);

  // Resolve contact *here*, before the minotaur moves. Walking into it is a
  // meeting; leaving the check until the end of the tick gives it a free step
  // out of the way and lets you pass straight through.
  if (hasMet(next, playerWas, minotaurWas)) {
    next = applyContact(next);
  } else if (next.minotaur && next.minotaurCooldown <= 0) {
    const decision = decideMinotaur(
      {
        maze: next.maze,
        at: next.minotaur,
        cameFrom: next.minotaurFrom,
        player: next.player,
        playerArmed: isArmed(next),
        lastSeen: next.minotaurLastSeen,
        memory: next.minotaurMemory,
      },
      createRng(next.rngState),
    );
    next = {
      ...next,
      minotaurFrom: next.minotaur,
      minotaur: decision.moveTo,
      minotaurMode: decision.mode,
      minotaurLastSeen: decision.lastSeen,
      minotaurMemory: decision.memory,
      minotaurCooldown: MINOTAUR_STEP_SECONDS,
    };
    if (hasMet(next, playerWas, minotaurWas)) next = applyContact(next);
  }

  if (next.status !== "playing") return next;

  if (next.hunger <= 0) {
    next = loseLife(next);
    if (next.status !== "playing") return next;
  }

  if (sameCell(next.player, next.exit)) {
    const score = next.score + LEVEL_SCORE;
    return {
      ...next,
      score,
      status: next.level >= LEVEL_COUNT ? "won" : "levelComplete",
    };
  }

  return next;
}

export function nextLevel(state: GameState, seed: number): GameState {
  return createLevel(state.level + 1, seed, state.lives, state.score);
}
