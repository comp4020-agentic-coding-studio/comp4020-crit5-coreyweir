# COMP4020 C5 — A game

A static site in HTML/CSS/TypeScript, built with Vite, deployed to GitHub Pages.
The deployed site is what gets marked, not this repo.

The [brief and spec](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/crits/05-game/)
are published on the course website. The brief poses the problem; the spec is
the fixed contract. Read both before planning or building.

## What we're building

**A first-person labyrinth game.** You are lost underground and starving.
Something is down here with you, and it carries a torch.

- **Grid movement, first person.** Forward, and 90° turns. Discrete — no analog
  movement, no mouselook.
- **Hunger drains in real time.** It empties, you lose a life. Three lives.
- **Food** sits in the maze and refills hunger. **Score is separate from
  hunger** — see the decisions below; this separation is load-bearing.
- **A minotaur** patrols, carrying a torch. Same speed as you. It chases on
  sight.
- **Swords** at fixed points in the maze. Picking one up is a brief timed
  power-up granting a **speed boost**. While armed, the minotaur flees on
  sight — so you can ambush it by approaching where it can't see you. Walking
  into it while armed kills it and drops meat.
- **The exit** is green daylight, visible *through* walls. You always know
  where; never how.
- **Levels escalate**: maze size, braid factor, hunger rate, pickup density.

One mechanic — hunger against a maze — with the minotaur as a tax on your route
rather than an assassin.

## The design, and why

Do not silently revisit these. Several were reached by rejecting a specific
alternative, and those alternatives are recorded so they don't get re-proposed.

- **No instructions, anywhere.** The spec is explicit: no how-to-play modal, no
  instructions page, nothing in the README standing in for either. Naming the
  game is fine. The opening screen has to make the first move obvious and play
  teaches the rest. The pod plays it cold and the presenter stays silent until
  someone finishes or gives up, so this can't be patched at the crit.
- **Level 1 is the tutorial, and it is made of level design.** Tiny maze, one
  food, exit in sight. The whole loop is legible in about twenty seconds. This
  is what "World 1-1" actually means: the teaching is the layout, not signage.
  It also protects the five-minute completion line, since early levels cost
  seconds.
- **Darkness is mood, not mechanic.** An earlier design made your light a
  resource that decayed and killed you. It was rejected for three reasons and
  all three still apply: nobody's mental model says dark = lethal; a level that
  *teaches* death-by-darkness is a level you failed; and you can't make routing
  judgements about light sources you can't see. The general trap: **darkness
  destroys the information any dilemma needs.** Keep the maze dim enough for
  atmosphere and lit enough to play — wall torches.
- **Hunger, not light, is the clock.** An emptying hunger bar is understood by
  everyone with no explanation, and food restoring it needs no explanation
  either. That legibility is the entire reason it replaced the light mechanic.
- **Hunger drains per second, not per step.** Per-step drain makes standing
  still free, and camping in a corner waiting for the minotaur to wander off
  becomes a dominant strategy. Per-second closes that.
- **Score and hunger are separate currencies.** If the thing that scores you is
  also the thing that protects you, then playing well and being safe are the
  same act and there is no tradeoff left. Merging them also revives the sprint
  exploit: max your food, run at the exit, never risk anything. Keep them apart.
- **The minotaur is a route tax, not a threat to outrun.** A single same-speed
  pursuer can't corner you, so it doesn't need to. Its job is to force detours,
  and detours cost hunger. Do not "fix" it by adding more pursuers — multiple
  hunters in a maze you can't see whole is luck, not skill.
- **It carries a torch, and that's what makes it trackable.** A moving light
  bleeding around a corner tells you something is coming before you see it — at
  distance, with no UI. Same principle as the exit beacon: you know where, not
  how. This is also what makes the flee-and-chase version playable at all;
  without it, hunting in a maze is a coinflip.
- **Fleeing is triggered by line of sight**, which is what makes ambush
  possible: approach around a corner while armed and close the distance before
  it bolts. Cornering is then a spatial read, not a speed race.
- **The braid factor is the real difficulty dial for the hunt.** A pure
  spanning-tree maze is all dead ends, so a fleeing minotaur can be cornered.
  Add loops and it runs forever. Tune braid before you tune speed.
- **Attacking is automatic on contact while armed.** No attack button. Nothing
  extra to discover wordlessly, nothing extra to add for touch, and it's the
  more legible behaviour: you have a sword, you walk into the beast, the beast
  loses.
- **The sword is timed and there are several.** A permanent one-use sword exerts
  no pressure on your route, because you just carry it. Fixed locations plus a
  clock turns them into anchors you plan around.
- **This is not a Pac-Man clone, and here is the sentence for the crit if a pod
  member says it is:** Pac-Man has no survival clock, killing ghosts is optional
  points, and you have full map knowledge. Here hunger is the clock, killing the
  minotaur *feeds* you, and you're navigating blind. The power-up mechanic is
  recontextualised, not borrowed.
- **Stack stays as the template ships it** (Vite + TypeScript). No migration
  this week.
- **Three.js for rendering.** Not raw WebGL — shaders and matrix maths are hours
  of risk with no marks attached. Not an engine compiled to WASM either: it puts
  the game logic inside a binary where vitest can't reach it, and the spec
  requires a focused automated test of a game rule.

## The shape of the code

The rules must not know that Three.js exists. This is the same discipline as C4
pulling arithmetic out of the audio graph, for the same reason: if a test can't
see it, it isn't tested.

- `src/maze.ts` — generation: spanning tree plus a braid parameter. Pure,
  seeded, deterministic.
- `src/grid.ts` — cells, directions, turning, line of sight down a corridor.
  Pure.
- `src/game.ts` — the state machine: hunger, pickups, scoring, lives, armed
  state and its timer, contact resolution, win and loss. Pure. No DOM, no
  `three`, no clock reads — time arrives as a delta argument.
- `src/minotaur.ts` — chase and flee decisions given a state. Pure.
- `src/render.ts` — the Three.js scene. **The only file that imports `three`.**
- `src/hud.ts` — hunger, lives, score as real DOM.
- `src/input.ts` — keyboard and touch resolved to intents (`forward`,
  `turnLeft`, `turnRight`). One abstraction, several modalities — do not write
  separate handlers that duplicate the mapping.
- `main.ts` — wiring, and nothing else. If logic accumulates here it belongs in
  one of the above.

## Testing stance

Test the rules; play for the feel.

- **The rules module is pure, so test it directly.** Maze connectivity, hunger
  arithmetic, pickup resolution, line of sight, the armed/unarmed contact rule,
  win and loss transitions.
- **The focused rule test the spec asks for is the contact rule** — armed
  contact kills the minotaur and drops meat; unarmed contact costs a life. The
  whole design hinges on it.
- **A generated maze must always be solvable.** Spanning-tree generation
  guarantees connectivity by construction, so assert it as a property over many
  seeds rather than trusting the algorithm.
- **Do not write tests for feel**: speed delta, hunger rate, whether the
  minotaur is frightening, whether the first level teaches. Open it and play.
  The spec requires that one change came from *playing* the finished game rather
  than reading its code — so that play session is a deliverable, not a luxury.
- **Write tests you will definitely turn green.** The weekly crit mark drops
  from 1 to 0.5 if the checks aren't green when the course's sweep runs. Three
  tight rule tests that pass beat eight aspirational ones that describe a game
  we didn't finish.
- Don't test implementation. Test what the game must *do*, so the tests survive
  a change of approach.

## Rendering facts that are easy to get wrong

- **`PerspectiveCamera.fov` is the *vertical* field of view.** The phone
  viewport is 390×844 portrait, so `aspect` is well under 1 and the horizontal
  view is *much* narrower than on desktop — you'd lose the ability to see a
  minotaur in a side corridor. Pick a target horizontal FOV and derive the
  vertical one: `fov = 2 * atan(tan(hFov / 2) / aspect)`, recomputed on resize.
  Do not ship a fixed `fov`.
- **Clamp the frame delta.** Hunger drains per second from
  `requestAnimationFrame` deltas, and a backgrounded tab returns one enormous
  delta that starves the player instantly through no fault of theirs. Clamp to
  something like 100ms per frame.
- **Keep game state on the grid; animate only the visuals between cells.** The
  renderer interpolates position for smoothness; it never owns where you are.
  If the renderer becomes the source of truth, the rules stop being testable.
- **Shadow-casting point lights are expensive** — each one is a cube shadow map.
  The minotaur's torch is the light that earns shadows; wall torches should be
  cheap unshadowed lights or baked into the material.
- **On resize, update both** `renderer.setSize` and `camera.aspect` followed by
  `camera.updateProjectionMatrix()`. Missing the second gives a stretched view
  that looks like a CSS bug and isn't. Toggling Chrome's device toolbar fires
  this path, so it is on the marking route.
- **If sound is added, the `AudioContext` starts suspended** and `resume()` must
  be called from inside a real user-gesture handler. Same rule that cost time in
  C4.
- **Set `touch-action: none`** on the canvas, or scroll and pinch-zoom eat the
  gestures on a phone.

## The two marking viewports

Prototypes are assessed in the latest stable Chrome at **1920×1080** and
**390×844** (the iPhone preset in Chrome DevTools' device toolbar). Both are
full marking environments. The brief also asks that the finished game be played
at both.

Keyboard input does still work at 390×844, because DevTools emulation runs on a
desktop with a keyboard attached — so keyboard is a legitimate primary input.
What has to hold up there is the **layout**: canvas fits, hunger bar legible at
390px wide, FOV corrected for portrait. Tap zones (left third turns left, right
third turns right, centre steps forward) are a cheap addition and map onto the
discrete controls with no redesign.

## The invariants constrain the layout

`spec/invariants.test.ts` runs against `dist/` and requires a `<nav>` landmark
and exactly one `<h1>`, plus lang, title, meta description, `og:image`, and a
mobile viewport. Satisfy them quietly — a small title and a minimal nav will do.

**The `<h1>` must not become an instruction.** Naming the game is allowed;
"Use the arrow keys to escape" is exactly what the spec forbids. The same goes
for the meta description and the README.

Keep any real controls as focusable DOM. The canvas is the game and stays out of
the accessibility story.

## How to work in here

- Keep the dev server running (`pnpm dev`) so you see changes as you make them.
- **Open it and play it.** The rendered page is the truth; a mental model of it
  isn't. This matters more here than usual — a game is judged on feel, and the
  spec requires a change that came from playing.
- Screenshot both viewports rather than assuming:
  `chromium --headless --disable-gpu --no-sandbox --hide-scrollbars
  --window-size=1920,1080 --screenshot=/tmp/x.png --virtual-time-budget=2500
  http://localhost:5173/`, and again at `390,844`.
- **A media query wins nothing on specificity — only on source order.** A
  breakpoint override must appear *later* in the file than the base rule it
  overrides. This cost time twice in C4, in both directions.
- **`[hidden]` loses to any class that sets `display`.** If anything is hidden by
  the `hidden` attribute, back it with `[hidden] { display: none !important }`.
- Run `pnpm check` before you push.
- When a check fails, read its output before changing anything.
- Never commit a red state. Commit as you go; the commit trail is assessed
  process evidence, and `PROCESS.md` must cite SHAs that actually resolve.

## The link-preview card

`public/card.png` (1200x630) is the image a shared link shows; `index.html`'s
head points at it. Replace it — a screenshot of the game is the obvious choice,
which means it is blocked on the game existing. Don't leave it to the cutoff.
Nothing in CI checks the card resolves, so the deployed head is the only place a
broken one shows up.

## The checks

`pnpm check` runs them; `pnpm check:evidence` is the extra gate before you ship.
CI runs the same plus links, secrets and the deploy. Read the failure.

`spec/README.md`, `PROCESS.md` and `reflections/README.md` are in this repo and
say what they are for. This week's reflection is `reflections/crit-5.md` —
`check:evidence` hard-fails on any other name.
