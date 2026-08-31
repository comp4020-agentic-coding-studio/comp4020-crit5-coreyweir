// Hunger, lives and score as real DOM.
//
// Everything here is a shape or a number. A draining bar and a row of pips are
// understood without being taught; a sentence explaining them would be exactly
// what the brief forbids.

import { type GameState, isArmed } from "./game";

export interface Hud {
  update(state: GameState): void;
  flash(message: string): void;
  clearFlash(): void;
}

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`missing ${selector}`);
  return element;
}

export function createHud(): Hud {
  const hunger = required<HTMLElement>("#hunger-fill");
  const lives = required<HTMLElement>("#lives");
  const score = required<HTMLElement>("#score");
  const sword = required<HTMLElement>("#sword");
  const overlay = required<HTMLElement>("#overlay");

  let renderedLives = -1;

  return {
    update(state) {
      hunger.style.transform = `scaleX(${Math.max(0, state.hunger)})`;
      hunger.dataset.low = state.hunger < 0.25 ? "true" : "false";

      if (state.lives !== renderedLives) {
        lives.replaceChildren(
          ...Array.from({ length: Math.max(0, state.lives) }, () => {
            const pip = document.createElement("span");
            pip.className = "pip";
            return pip;
          }),
        );
        renderedLives = state.lives;
      }

      score.textContent = String(state.score);
      sword.dataset.armed = isArmed(state) ? "true" : "false";
      sword.style.transform = `scaleX(${Math.max(0, state.armedFor / 8)})`;
    },

    flash(message) {
      overlay.textContent = message;
      overlay.dataset.visible = "true";
    },

    clearFlash() {
      overlay.dataset.visible = "false";
    },
  };
}
