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

let state = createLevel(1, seed());
let hold = 0;
let last = performance.now();

// The device toolbar toggling counts as a resize, and it is on the marking
// route, so watch the element rather than just the window.
new ResizeObserver(() => {
  renderer.resize(canvas.clientWidth || 1, canvas.clientHeight || 1);
}).observe(canvas);
renderer.resize(canvas.clientWidth || 1, canvas.clientHeight || 1);

function settle(): void {
  hud.clearFlash();
  if (state.status === "levelComplete") {
    state = nextLevel(state, seed());
  } else {
    state = createLevel(1, seed());
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
