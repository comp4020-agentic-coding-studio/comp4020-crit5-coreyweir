// The thread you leave behind you.
//
// Playing it through, the thing that made the game feel unfair was not the
// minotaur — it was reversing into a dead end you had already been down and
// had no way to remember. That is not tension, it is bookkeeping the player is
// being asked to do in their head.
//
// So: a map of *what you have seen*, and nothing else. The maze ahead is still
// dark, which is the whole navigation game and the reason this is not Pac-Man
// — you never get full map knowledge, you accumulate it. The exit is on it
// from the first frame because the beacon already tells you that through the
// walls; the map just says it in plan view.

import { type GameState } from "./game";
import { cellIndex, isOpen } from "./maze";

export interface Minimap {
  draw(state: GameState): void;
}

const SEEN = "rgba(232, 226, 214, 0.10)";
const WALL = "rgba(232, 226, 214, 0.5)";
const YOU = "#ff9a3c";
const OUT = "#5fe39a";

export function createMinimap(canvas: HTMLCanvasElement): Minimap {
  const ctx = canvas.getContext("2d");

  return {
    draw(state) {
      if (!ctx) return;
      const { maze } = state;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const box = canvas.clientWidth || 150;
      const px = Math.round(box * dpr);
      if (canvas.width !== px) {
        canvas.width = px;
        canvas.height = px;
      }

      const size = canvas.width / Math.max(maze.width, maze.height);
      const ox = (canvas.width - maze.width * size) / 2;
      const oy = (canvas.height - maze.height * size) / 2;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.lineWidth = Math.max(1, size * 0.1);
      ctx.lineCap = "square";

      for (let y = 0; y < maze.height; y += 1) {
        for (let x = 0; x < maze.width; x += 1) {
          if (!state.seen[cellIndex(maze, { x, y })]) continue;
          const left = ox + x * size;
          const top = oy + y * size;

          ctx.fillStyle = SEEN;
          ctx.fillRect(left, top, size, size);

          // Only the walls of cells you have seen get drawn, so the frontier
          // of the map is a ragged edge rather than a rectangle.
          ctx.strokeStyle = WALL;
          ctx.beginPath();
          if (!isOpen(maze, { x, y }, 0)) {
            ctx.moveTo(left, top);
            ctx.lineTo(left + size, top);
          }
          if (!isOpen(maze, { x, y }, 1)) {
            ctx.moveTo(left + size, top);
            ctx.lineTo(left + size, top + size);
          }
          if (!isOpen(maze, { x, y }, 2)) {
            ctx.moveTo(left, top + size);
            ctx.lineTo(left + size, top + size);
          }
          if (!isOpen(maze, { x, y }, 3)) {
            ctx.moveTo(left, top);
            ctx.lineTo(left, top + size);
          }
          ctx.stroke();
        }
      }

      ctx.fillStyle = OUT;
      ctx.fillRect(
        ox + state.exit.x * size + size * 0.25,
        oy + state.exit.y * size + size * 0.25,
        size * 0.5,
        size * 0.5,
      );

      // An arrow, not a dot: which way you are pointing is half of what you
      // came to the map to find out.
      const cx = ox + state.player.x * size + size / 2;
      const cy = oy + state.player.y * size + size / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((state.facing * Math.PI) / 2);
      ctx.fillStyle = YOU;
      ctx.beginPath();
      ctx.moveTo(0, -size * 0.38);
      ctx.lineTo(size * 0.28, size * 0.3);
      ctx.lineTo(0, size * 0.12);
      ctx.lineTo(-size * 0.28, size * 0.3);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    },
  };
}
