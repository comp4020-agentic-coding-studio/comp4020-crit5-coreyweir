// Keyboard and touch resolved to the same three intents.
//
// One abstraction, several modalities: pointer events cover mouse and touch in
// a single path, and a key map covers keys. Nothing downstream knows or cares
// which was used.

import type { Intent } from "./game";

export interface Input {
  /** The intent currently being held, most recent press wins. */
  current(): Intent | null;
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

export function createInput(surface: HTMLElement): Input {
  // A stack rather than a set: holding forward and then pressing left should
  // turn, and releasing left should go back to walking.
  const held: Intent[] = [];

  const press = (intent: Intent): void => {
    const at = held.indexOf(intent);
    if (at !== -1) held.splice(at, 1);
    held.push(intent);
  };

  const release = (intent: Intent): void => {
    const at = held.indexOf(intent);
    if (at !== -1) held.splice(at, 1);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    const intent = KEYS[event.code];
    if (!intent) return;
    event.preventDefault();
    if (event.repeat) return;
    press(intent);
  };

  const onKeyUp = (event: KeyboardEvent): void => {
    const intent = KEYS[event.code];
    if (intent) release(intent);
  };

  // Tap zones: the third of the screen you touch is the way you go. Nothing to
  // read, nothing to learn.
  const pointers = new Map<number, Intent>();

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
    pointers.set(event.pointerId, intent);
    press(intent);
    surface.setPointerCapture(event.pointerId);
  };

  const onPointerUp = (event: PointerEvent): void => {
    const intent = pointers.get(event.pointerId);
    if (!intent) return;
    pointers.delete(event.pointerId);
    release(intent);
  };

  const onBlur = (): void => {
    held.length = 0;
    pointers.clear();
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  surface.addEventListener("pointerdown", onPointerDown);
  surface.addEventListener("pointerup", onPointerUp);
  surface.addEventListener("pointercancel", onPointerUp);

  return {
    current: () => (held.length > 0 ? held[held.length - 1] : null),
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
