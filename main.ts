// Wiring, and nothing else. If logic starts accumulating here it belongs in
// one of the modules under src/.

import { LEVEL_COUNT, MAX_DELTA, createLevel, nextLevel, tick } from "./src/game";
import { createHud } from "./src/hud";
import { createInput } from "./src/input";
import { createRenderer } from "./src/render";

const canvas = document.querySelector<HTMLCanvasElement>("#view");
if (!canvas) throw new Error("missing #view");

const renderer = createRenderer(canvas);
const input = createInput(canvas);
const hud = createHud();

const seed = () => Math.floor(Math.random() * 2 ** 31);

// Dev-only: ?level=4 to look at a level without playing up to it. Stripped
// from the production bundle, so there is no backdoor in the shipped game.
const startLevel = import.meta.env.DEV
  ? Number(new URLSearchParams(location.search).get("level")) || 1
  : 1;

let state = createLevel(startLevel, seed());
let hold = 0;
let last = performance.now();

// The renderer re-measures itself every frame, so rotating the phone or
// toggling the device toolbar needs no event plumbing here.

function settle(): void {
  hud.clearFlash();
  if (state.status === "levelComplete") {
    state = nextLevel(state, seed());
  } else {
    state = createLevel(startLevel, seed());
  }
}

function frame(now: number): void {
  // Clamp: a backgrounded tab hands back one enormous delta on its first frame.
  const dt = Math.min((now - last) / 1000, MAX_DELTA);
  last = now;

  if (hold > 0) {
    hold -= dt;
    if (hold <= 0) settle();
  } else {
    state = tick(state, dt, input.current());
    if (state.status === "levelComplete") {
      hold = state.level >= LEVEL_COUNT ? 1.4 : 0.9;
    } else if (state.status === "gameOver") {
      hud.flash("the labyrinth keeps you");
      hold = 2.6;
    } else if (state.status === "won") {
      hud.flash(`daylight · ${state.score}`);
      hold = 4.5;
    }
  }

  hud.update(state);
  renderer.update(state, dt);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
