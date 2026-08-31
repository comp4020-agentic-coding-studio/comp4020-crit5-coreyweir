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
  generateMaze,
  isOpen,
  openRoom,
} from "./maze";
import { type MinotaurMode, decideMinotaur } from "./minotaur";

export type Intent = "forward" | "turnLeft" | "turnRight";
export type Status = "playing" | "levelComplete" | "gameOver" | "won";

// Tuning. These are the numbers that get changed by playing, not by reasoning.
export const BASE_STEP_SECONDS = 0.2;
export const ARMED_STEP_SECONDS = 0.12;
export const TURN_SECONDS = 0.14;
export const MINOTAUR_STEP_SECONDS = 0.2;
export const SWORD_SECONDS = 8;
export const FOOD_RESTORE = 0.3;
export const MEAT_RESTORE = 0.55;
export const FOOD_SCORE = 10;
export const MEAT_SCORE = 50;
export const LEVEL_SCORE = 25;
export const STARTING_LIVES = 3;
export const LEVEL_COUNT = 5;

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
  readonly status: Status;
  readonly playerCooldown: number;
  readonly minotaurCooldown: number;
  readonly rngState: number;
}

export interface LevelConfig {
  readonly width: number;
  readonly height: number;
  readonly braid: number;
  readonly hungerRate: number;
  readonly food: number;
  readonly swords: number;
  readonly minotaur: boolean;
  /** No internal walls — the shape level 1 needs to teach itself. */
  readonly openRoom?: boolean;
}

/**
 * Level 1 is the tutorial and it is made of level design: a room small enough
 * to see the whole loop in, one thing to eat, and the way out. Nothing hunts
 * you there, because the lesson is "move, eat, leave" and nothing else.
 */
export function levelConfig(level: number): LevelConfig {
  if (level <= 1) {
    return {
      width: 5,
      height: 5,
      braid: 0,
      hungerRate: 0.012,
      food: 2,
      swords: 0,
      minotaur: false,
      openRoom: true,
    };
  }
  const size = Math.min(3 + (level - 1) * 2, 13);
  return {
    width: size,
    height: size,
    braid: Math.min((level - 2) * 0.12, 0.4),
    hungerRate: 0.016 + (level - 2) * 0.004,
    food: 2 + level,
    swords: 1 + Math.floor(level / 3),
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
  const maze = config.openRoom
    ? openRoom(config.width, config.height)
    : generateMaze(config.width, config.height, config.braid, rng);

  // Level 1 is authored, not generated. A tutorial made of level design has to
  // be composed: the way out dead ahead so the goal needs no stating, and the
  // food deliberately off that line so the first thing you learn is that
  // stepping aside is worth something.
  const middle = Math.floor(config.height / 2);
  const start: Vec = config.openRoom ? { x: 0, y: middle } : { x: 0, y: 0 };
  const exit = config.openRoom
    ? { x: config.width - 1, y: middle }
    : farthestFrom(maze, start);
  const taken: Vec[] = [start, exit];

  const food = config.openRoom
    ? [
        { x: 2, y: middle - 1 },
        { x: 2, y: middle + 1 },
      ].filter((c) => c.y >= 0 && c.y < config.height)
    : pickCells(maze, config.food, taken, rng);
  taken.push(...food);
  const swords = pickCells(maze, config.swords, taken, rng);
  taken.push(...swords);

  let minotaur: Vec | null = null;
  if (config.minotaur) {
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
    playerCooldown: 0,
    minotaurCooldown: MINOTAUR_STEP_SECONDS,
    rngState: seed,
  };
}

export function isArmed(state: GameState): boolean {
  return state.armedFor > 0;
}

export function playerStepSeconds(state: GameState): number {
  return isArmed(state) ? ARMED_STEP_SECONDS : BASE_STEP_SECONDS;
}

/** Losing a life resets the level's positions but never the score. */
function loseLife(state: GameState): GameState {
  const lives = state.lives - 1;
  if (lives <= 0) {
    return { ...state, lives: 0, hunger: 0, status: "gameOver" };
  }
  return {
    ...state,
    lives,
    hunger: 1,
    armedFor: 0,
    player: state.start,
    facing: openingFacing(state.maze, state.start, state.exit),
    playerCooldown: 0,
    minotaur: state.minotaur ? farthestFrom(state.maze, state.start) : null,
    minotaurFrom: null,
    minotaurLastSeen: null,
    minotaurMemory: 0,
    minotaurMode: "patrolling",
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
    if (intent === "turnLeft") {
      next = {
        ...next,
        facing: turnLeft(next.facing),
        playerCooldown: TURN_SECONDS,
      };
    } else if (intent === "turnRight") {
      next = {
        ...next,
        facing: turnRight(next.facing),
        playerCooldown: TURN_SECONDS,
      };
    } else if (isOpen(next.maze, next.player, next.facing)) {
      next = {
        ...next,
        player: stepFrom(next.player, next.facing),
        playerCooldown: playerStepSeconds(next),
      };
    }
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
