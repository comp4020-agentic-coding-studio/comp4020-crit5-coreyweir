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

/**
 * Free mouse look was tried and removed after a playthrough.
 *
 * On paper it fixed the cost of turning: glance down a side corridor without
 * committing your feet to it. In the hand it did the opposite — the body is on
 * a four-direction grid, so a head that points anywhere else means the thing
 * you are looking at and the thing forward will walk into are different, and
 * every step became a small act of translation. Turning is the game's one real
 * cost and hiding it made the game harder to read, not easier. Reverted; the
 * wider 104-degree field of view is what actually solved the peripheral
 * problem it was aimed at.
 */

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
  const turns: Intent[] = [];
  // Which keys are currently asking to keep walking. A set rather than a flag
  // because two of them can say so at once.
  const treading = new Set<string>();

  const queue = (intent: Intent): void => {
    // Two deep: a deliberate double tap is a 180, and nothing beyond that is
    // anything but a mistake you would have to unwind.
    if (turns.length < 2) turns.push(intent);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    const intent = KEYS[event.code];
    if (!intent) return;
    event.preventDefault();
    if (event.repeat) return;
    if (isTurn(intent)) queue(intent);
    // Turning round is what you do with something behind you, and standing
    // still to admire it afterwards is not the next thing you wanted. Holding
    // it spins you once and then runs.
    if (intent === "forward" || intent === "turnAround") treading.add(event.code);
  };

  const onKeyUp = (event: KeyboardEvent): void => {
    treading.delete(event.code);
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
    const intent = zoneOf(event.clientX);
    if (isTurn(intent)) {
      queue(intent);
      return;
    }
    walkers.add(event.pointerId);
    surface.setPointerCapture(event.pointerId);
  };

  const onPointerUp = (event: PointerEvent): void => {
    walkers.delete(event.pointerId);
  };

  const onBlur = (): void => {
    treading.clear();
    walkers.clear();
    turns.length = 0;
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  surface.addEventListener("pointerdown", onPointerDown);
  surface.addEventListener("pointerup", onPointerUp);
  surface.addEventListener("pointercancel", onPointerUp);

  return {
    pending: () =>
      turns[0] ?? (treading.size > 0 || walkers.size > 0 ? "forward" : null),
    turned() {
      turns.shift();
    },
    dispose() {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      surface.removeEventListener("pointerdown", onPointerDown);
      surface.removeEventListener("pointerup", onPointerUp);
      surface.removeEventListener("pointercancel", onPointerUp);
    },
  };
}
