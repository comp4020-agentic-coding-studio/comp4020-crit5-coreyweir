// Hunger, lives and score as real DOM.
//
// Everything here is a shape or a number, because a sentence explaining them
// would be exactly what the brief forbids. The rule that makes them legible is
// that **every gauge is the colour and silhouette of the thing in the maze it
// refers to**: the hunger bar wears the same bitten circle as the food you
// pick up, the armed timer wears the blade. Eat something, watch the bar with
// that shape on it jump, and the gauge has explained itself without a word.
//
// Lives are hearts, and score is a number that visibly grows by the amount you
// just earned. Neither of those needed inventing.

import { type GameState, SWORD_SECONDS, isArmed } from "./game";

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

function heart(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "pip");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", "#glyph-life");
  svg.append(use);
  return svg;
}

export function createHud(): Hud {
  const gauge = required<HTMLElement>("#gauge");
  const hunger = required<HTMLElement>("#hunger-fill");
  const lives = required<HTMLElement>("#lives");
  const score = required<HTMLElement>("#score");
  const gain = required<HTMLElement>("#gain");
  const sword = required<HTMLElement>("#sword");
  const swordFill = required<HTMLElement>("#sword-fill");
  const wound = required<HTMLElement>("#wound");
  const overlay = required<HTMLElement>("#overlay");

  let renderedLives = -1;
  let renderedScore = 0;

  /** Setting the attribute twice in a row does nothing; this replays it. */
  const replay = (element: HTMLElement, key: string): void => {
    delete element.dataset[key];
    void element.offsetWidth;
    element.dataset[key] = "true";
  };

  return {
    update(state) {
      hunger.style.transform = `scaleX(${Math.max(0, state.hunger)})`;
      gauge.dataset.low = state.hunger < 0.3 ? "true" : "false";

      if (state.lives !== renderedLives) {
        const lost = state.lives < renderedLives && renderedLives !== -1;
        lives.replaceChildren(
          ...Array.from({ length: Math.max(0, state.lives) }, heart),
        );
        if (lost) {
          replay(lives, "lost");
          replay(wound, "hit");
        }
        renderedLives = state.lives;
      }

      if (state.score !== renderedScore) {
        // The floating number is the whole explanation of what the number in
        // the corner is. It only works if it says how much, and appears next
        // to the thing it changed.
        const delta = state.score - renderedScore;
        if (delta > 0) {
          gain.textContent = `+${delta}`;
          replay(gain, "show");
        }
        score.textContent = String(state.score);
        renderedScore = state.score;
      }

      const armed = isArmed(state);
      sword.dataset.armed = armed ? "true" : "false";
      swordFill.style.transform = `scaleX(${Math.max(0, state.armedFor / SWORD_SECONDS)})`;
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
