// Keyboard, mouse and touch resolved to the same four intents, plus a head.
//
// One abstraction, several modalities: pointer events cover mouse and touch in
// a single path, and a key map covers keys. Nothing downstream knows or cares
// which was used.

import type { Intent } from "./game";

export interface Input {
  /**
   * What to act on this frame. A queued turn beats a held walk, because you
   * pressed it on purpose.
   */
  pending(): Intent | null;
  /** Called once the game has actually turned, so the queue can advance. */
  turned(): void;
  /**
   * Where the head is pointed, relative to the body, in the same space as
   * `camera.rotation.y` — so it goes *down* as the mouse goes right.
   */
  look(dt: number): number;
  dispose(): void;
}

const KEYS: Record<string, Intent> = {
  ArrowUp: "forward",
  KeyW: "forward",
  ArrowLeft: "turnLeft",
  KeyA: "turnLeft",
  ArrowRight: "turnRight",
  KeyD: "turnRight",
  // A nicety rather than a new ability: "dd" already did this, but reversing
  // out of a dead end with something behind you is not a moment for two taps.
  ArrowDown: "turnAround",
  KeyS: "turnAround",
};

/** As far round as a quarter turn would take you, and no further. */
const MAX_LOOK = Math.PI / 2;
const LOOK_PER_PIXEL = 0.0032;
/** Roughly a quarter turn in a quarter second, so a lock reads as a turn. */
const RECENTRE_RATE = 6.5;
/** Past this, "walk on" means the corridor you are looking down. */
const SNAP_AT = Math.PI / 4;

function isTurn(intent: Intent): boolean {
  return intent !== "forward";
}

export function createInput(surface: HTMLElement): Input {
  // Walking is a state you hold. Turning is an event you fire.
  //
  // They used to share one held-intent stack, and that was wrong in a way you
  // could feel: holding D a fraction too long spun you through two quarter
  // turns and left you facing backwards. A turn is a decision, so it happens
  // once per press however long the key is down.
  let walking = false;
  const turns: Intent[] = [];

  let head = 0;
  let recentring = false;

  const queue = (intent: Intent): void => {
    // Two deep: a deliberate double tap is a 180, and nothing beyond that is
    // anything but a mistake you would have to unwind.
    if (turns.length < 2) turns.push(intent);
    recentring = true;
  };

  // Pressing forward re-locks the body to whatever you are looking down. The
  // head is free, but your feet are always on the grid, so committing to a
  // direction has to be one gesture, not two.
  const goForward = (): void => {
    if (turns.length === 0) {
      if (head <= -SNAP_AT) queue("turnRight");
      else if (head >= SNAP_AT) queue("turnLeft");
    }
    recentring = true;
    walking = true;
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    const intent = KEYS[event.code];
    if (!intent) return;
    event.preventDefault();
    if (event.repeat) return;
    if (isTurn(intent)) queue(intent);
    else goForward();
  };

  const onKeyUp = (event: KeyboardEvent): void => {
    const intent = KEYS[event.code];
    if (intent && !isTurn(intent)) walking = false;
  };

  // Tap zones: the third of the screen you touch is the way you go. Nothing to
  // read, nothing to learn.
  const walkers = new Set<number>();

  const zoneOf = (clientX: number): Intent => {
    const box = surface.getBoundingClientRect();
    const third = box.width / 3;
    const x = clientX - box.left;
    if (x < third) return "turnLeft";
    if (x > third * 2) return "turnRight";
    return "forward";
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === "mouse") {
      // Mouse look wants the cursor out of the way and off the screen edges.
      // Optional, always: every rule of the game is reachable from the keys.
      if (document.pointerLockElement !== surface) void surface.requestPointerLock();
      return;
    }
    const intent = zoneOf(event.clientX);
    if (isTurn(intent)) {
      queue(intent);
      return;
    }
    walkers.add(event.pointerId);
    goForward();
    surface.setPointerCapture(event.pointerId);
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (!walkers.delete(event.pointerId)) return;
    if (walkers.size === 0) walking = false;
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (event.pointerType !== "mouse") return;
    if (event.movementX === 0) return;
    recentring = false;
    head = Math.max(
      -MAX_LOOK,
      Math.min(MAX_LOOK, head - event.movementX * LOOK_PER_PIXEL),
    );
  };

  const onBlur = (): void => {
    walking = false;
    walkers.clear();
    turns.length = 0;
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  window.addEventListener("pointermove", onPointerMove);
  surface.addEventListener("pointerdown", onPointerDown);
  surface.addEventListener("pointerup", onPointerUp);
  surface.addEventListener("pointercancel", onPointerUp);

  return {
    pending: () => turns[0] ?? (walking ? "forward" : null),
    turned() {
      turns.shift();
      recentring = true;
    },
    look(dt) {
      if (recentring && head !== 0) {
        const step = RECENTRE_RATE * dt;
        head = head > 0 ? Math.max(0, head - step) : Math.min(0, head + step);
      }
      return head;
    },
    dispose() {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("pointermove", onPointerMove);
      surface.removeEventListener("pointerdown", onPointerDown);
      surface.removeEventListener("pointerup", onPointerUp);
      surface.removeEventListener("pointercancel", onPointerUp);
    },
  };
}
