// The plan view.
//
// Playing it through, the thing that made the game feel unfair was not the
// minotaur — it was reversing into a dead end you had already been down and
// had no way to remember. That is not tension, it is bookkeeping the player is
// being asked to do in their head.
//
// It shipped first as fog of war, showing only what you had seen. That was the
// prettier idea and it was not enough: cornering yourself is something you do
// in the corridor you have *not* been down, so a map that only remembers is a
// map that arrives one death too late. It now draws the whole layout, with the
// cells you have actually walked or looked down picked out brighter — the
// thread is still there, it just no longer decides whether you can play.
//
// What it deliberately does not give you is the contents. No food, no swords,
// and the minotaur only when it already has line of sight to you — so the map
// answers "am I seen" rather than "where is it", and finding things is still
// done with your eyes. That, not the layout, is what keeps this from being
// Pac-Man: full map knowledge there is total, and here it is only the walls.

import { type GameState } from "./game";
import { cellIndex, hasLineOfSight, isOpen } from "./maze";

export interface Minimap {
  draw(state: GameState): void;
}

const KNOWN = "rgba(232, 226, 214, 0.045)";
const SEEN = "rgba(232, 226, 214, 0.16)";
const WALL = "rgba(232, 226, 214, 0.26)";
const WALL_SEEN = "rgba(232, 226, 214, 0.62)";
const YOU = "#ff9a3c";
const OUT = "#5fe39a";
const BEAST = "#ff5340";

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
          const seen = state.seen[cellIndex(maze, { x, y })] === 1;
          const left = ox + x * size;
          const top = oy + y * size;

          ctx.fillStyle = seen ? SEEN : KNOWN;
          ctx.fillRect(left, top, size, size);

          ctx.strokeStyle = seen ? WALL_SEEN : WALL;
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

      // It appears exactly when it can see you, which makes the map a warning
      // rather than a tracker: the thing it tells you is that you are exposed.
      if (state.minotaur && hasLineOfSight(maze, state.player, state.minotaur)) {
        ctx.fillStyle = BEAST;
        ctx.beginPath();
        ctx.arc(
          ox + state.minotaur.x * size + size / 2,
          oy + state.minotaur.y * size + size / 2,
          size * 0.3,
          0,
          Math.PI * 2,
        );
        ctx.fill();
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
