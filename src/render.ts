// The scene. The ONLY file that imports `three`.
//
// It reads game state and draws it. It never decides anything: the grid is the
// truth, and everything here interpolates toward it.

import * as THREE from "three";

import { type Dir, type Vec, delta } from "./grid";
import { type Maze, isOpen } from "./maze";
import { type GameState, MINOTAUR_STEP_SECONDS, isArmed } from "./game";

/**
 * Four was a hall, not a corridor, and it made every single press of forward
 * cover four metres in a quarter second. Held down that reads as walking; hit
 * once it reads as a teleport, which is what made the movement feel discrete
 * however smoothly it was interpolated. The cell is the step length, so the
 * cell is what had to shrink.
 */
const CELL = 2.75;
const WALL_HEIGHT = 3.1;
const WALL_THICKNESS = 0.42;
const EYE_HEIGHT = 1.6;

/**
 * The phone viewport is 390x844 portrait. `PerspectiveCamera.fov` is the
 * VERTICAL field of view, so a fixed fov there would narrow the horizontal view
 * to a letterbox and you'd never see a minotaur in a side corridor. Hold the
 * horizontal angle steady instead and derive the vertical one.
 */
// Widened from 88 after playtesting: at 88 you had to tap right-left-left to
// check a side opening before stepping out, because a junction beside you sat
// outside the frame. Peripheral vision is the information a first-person maze
// runs on.
const TARGET_HORIZONTAL_FOV = 104;

function verticalFov(aspect: number): number {
  const h = (TARGET_HORIZONTAL_FOV * Math.PI) / 180;
  const v = 2 * Math.atan(Math.tan(h / 2) / aspect);
  // Capped well below the 129 degrees portrait actually asks for: past about
  // 100 the floor and ceiling swallow the frame and the corridor you are
  // trying to read gets squeezed into a band.
  return THREE.MathUtils.clamp((v * 180) / Math.PI, 45, 106);
}

function worldOf(cell: Vec): THREE.Vector3 {
  return new THREE.Vector3(cell.x * CELL, 0, cell.y * CELL);
}

/** Facing 0..3 (N E S W) as a yaw. North is -z. */
function yawOf(facing: number): number {
  return -facing * (Math.PI / 2);
}

/** Shortest signed angle from a to b, so turning never spins the long way. */
function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

interface Pickup {
  readonly mesh: THREE.Object3D;
  readonly cell: Vec;
  /** The height it bobs around. */
  readonly rest: number;
}

export interface Renderer {
  /** Idempotent; called every frame. */
  resize(): void;
  /** `look` is the head's yaw offset from the body — see `src/input.ts`. */
  update(state: GameState, dt: number, look?: number): void;
  dispose(): void;
}

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05060a);
  // Fog does the mood work cheaply, and hides the far edge of the maze.
  scene.fog = new THREE.FogExp2(0x05060a, 0.078);

  const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 200);
  camera.position.y = EYE_HEIGHT;

  scene.add(new THREE.AmbientLight(0x46536e, 0.5));

  // Your own light, kept short-range: enough to read the walls beside you,
  // not enough to floodlight the maze.
  const carried = new THREE.PointLight(0xffc789, 8, 9, 1.8);
  carried.position.y = EYE_HEIGHT;
  scene.add(carried);

  /** Mottled noise, drawn once. Cheaper than shipping an image and it tiles. */
  function stoneTexture(base: string, speckle: string): THREE.CanvasTexture {
    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = speckle;
      for (let i = 0; i < 9000; i += 1) {
        ctx.globalAlpha = 0.04 + Math.random() * 0.14;
        const r = 1 + Math.random() * 3;
        ctx.fillRect(Math.random() * size, Math.random() * size, r, r);
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  const stoneMap = stoneTexture("#8d8479", "#3a3129");
  // Each wall block is a scaled unit cube, so UVs run 0..1 across a face
  // whatever its real size. Tiling twice keeps the grain from smearing.
  stoneMap.repeat.set(2, 1.6);
  const stone = new THREE.MeshStandardMaterial({
    map: stoneMap,
    color: 0xffffff,
    roughness: 0.95,
    metalness: 0,
  });
  const floorMat = new THREE.MeshStandardMaterial({
    map: stoneTexture("#4c443a", "#221c16"),
    roughness: 1,
  });

  const level = new THREE.Group();
  scene.add(level);

  // --- the minotaur, and the torch that makes it trackable -----------------
  const beast = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.15, 2.2, 0.95),
    new THREE.MeshStandardMaterial({ color: 0x5b3f30, roughness: 0.85 }),
  );
  body.position.y = 1.1;
  body.castShadow = true;
  beast.add(body);
  const horns = new THREE.Mesh(
    new THREE.BoxGeometry(1.7, 0.2, 0.2),
    new THREE.MeshStandardMaterial({ color: 0xd8cdb4, roughness: 0.6 }),
  );
  horns.position.y = 2.1;
  beast.add(horns);
  const flame = new THREE.Mesh(
    new THREE.SphereGeometry(0.19, 10, 10),
    new THREE.MeshBasicMaterial({ color: 0xffb347 }),
  );
  flame.position.set(0.7, 1.75, 0);
  beast.add(flame);
  // The one light that earns a shadow map: it is what makes the torch bleed
  // around a corner instead of shining through the wall.
  const torch = new THREE.PointLight(0xffa542, 18, 16, 2);
  torch.position.set(0.7, 1.75, 0);
  torch.castShadow = true;
  torch.shadow.mapSize.set(512, 512);
  torch.shadow.camera.near = 0.4;
  torch.shadow.camera.far = 18;
  torch.shadow.bias = -0.004;
  beast.add(torch);
  scene.add(beast);

  // --- the way out ---------------------------------------------------------
  // depthTest off so it draws over the walls: you always know WHERE, never HOW.
  /** A soft radial glow. Daylight seen from inside a hill, not a strip light. */
  function glowTexture(core: string, mid: string, edge: string): THREE.CanvasTexture {
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, core);
      g.addColorStop(0.35, mid);
      g.addColorStop(1, edge);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  // depthTest off so it reads through the walls: you always know WHERE the way
  // out is, never HOW to get there. That asymmetry is the whole navigation game.
  const beacon = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTexture(
        "rgba(190,255,205,0.85)",
        "rgba(90,220,130,0.32)",
        "rgba(60,190,110,0)",
      ),
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      fog: false,
    }),
  );
  beacon.scale.set(5, 5, 1);
  beacon.renderOrder = 999;
  scene.add(beacon);

  const doorway = new THREE.Mesh(
    new THREE.BoxGeometry(CELL * 0.8, 0.1, CELL * 0.8),
    new THREE.MeshBasicMaterial({ color: 0x4fd987 }),
  );
  doorway.position.y = 0.06;
  scene.add(doorway);
  const doorLight = new THREE.PointLight(0x7dffa8, 8, 5, 2);
  doorLight.position.y = 1.5;
  scene.add(doorLight);

  // --- pickups -------------------------------------------------------------
  const pickups = new THREE.Group();
  scene.add(pickups);
  let live: Pickup[] = [];

  // Shape carries the meaning, because nothing is allowed to caption it. The
  // food wears the same silhouette and the same ember as the hunger gauge; the
  // sword wears the same steel blue as the timer that appears when you take
  // it. Pick one up, watch the matching gauge move, and the HUD is explained.
  const fleshMat = new THREE.MeshStandardMaterial({
    color: 0xff9a3c,
    emissive: 0x7a3708,
    roughness: 0.45,
  });
  const stalkMat = new THREE.MeshStandardMaterial({
    color: 0x4e7a34,
    roughness: 0.8,
  });
  const meatMat = new THREE.MeshStandardMaterial({
    color: 0xb04350,
    emissive: 0x3a1013,
    roughness: 0.7,
  });
  const boneMat = new THREE.MeshStandardMaterial({
    color: 0xe6dcc4,
    roughness: 0.6,
  });
  const swordMat = new THREE.MeshStandardMaterial({
    color: 0xdfe9ff,
    emissive: 0x6d92e0,
    emissiveIntensity: 1.6,
    roughness: 0.2,
    metalness: 0.85,
  });
  const hiltMat = new THREE.MeshStandardMaterial({
    color: 0x8fa9d8,
    emissive: 0x2c4478,
    roughness: 0.4,
    metalness: 0.7,
  });

  const bladeGlow = glowTexture(
    "rgba(226,238,255,0.9)",
    "rgba(120,164,255,0.34)",
    "rgba(70,120,220,0)",
  );

  function haloOf(scale: number, y: number): THREE.Sprite {
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: bladeGlow,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    halo.scale.set(scale, scale, 1);
    halo.position.y = y;
    return halo;
  }

  function makeFood(): THREE.Object3D {
    const g = new THREE.Group();
    const flesh = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), fleshMat);
    flesh.scale.y = 0.92;
    g.add(flesh);
    const stalk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.03, 0.22, 6),
      stalkMat,
    );
    stalk.position.y = 0.34;
    g.add(stalk);
    return g;
  }

  function makeMeat(): THREE.Object3D {
    const g = new THREE.Group();
    const bone = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 0.62, 6),
      boneMat,
    );
    bone.rotation.z = Math.PI / 2.6;
    g.add(bone);
    const chunk = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), meatMat);
    chunk.scale.set(1, 0.85, 0.85);
    chunk.position.set(-0.12, -0.1, 0);
    g.add(chunk);
    return g;
  }

  /**
   * The sword used to be a bare 14cm bar of white, and in a corridor lit by one
   * guttering torch you walked straight past it. It is the only thing in the
   * maze that changes what the minotaur does, so it gets a hilt to be
   * recognisable, a halo to be visible, and a light of its own to announce
   * itself from round a corner. The halo respects the walls — unlike the exit
   * beacon it is a landmark, not an x-ray.
   */
  function makeSword(): THREE.Object3D {
    const g = new THREE.Group();
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.15, 0.035), swordMat);
    blade.position.y = 0.62;
    g.add(blade);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.072, 0.24, 4), swordMat);
    tip.position.y = 1.31;
    tip.rotation.y = Math.PI / 4;
    g.add(tip);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.08, 0.08), hiltMat);
    g.add(guard);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.32, 0.075), hiltMat);
    grip.position.y = -0.2;
    g.add(grip);
    g.add(haloOf(2.6, 0.6));
    const light = new THREE.PointLight(0x9fc0ff, 6, 5, 2);
    light.position.y = 0.8;
    g.add(light);
    return g;
  }

  function addPickup(cell: Vec, mesh: THREE.Object3D, y: number): void {
    const at = worldOf(cell);
    mesh.position.set(at.x, y, at.z);
    pickups.add(mesh);
    live.push({ mesh, cell, rest: y });
  }

  function syncPickups(state: GameState): void {
    const want = [
      ...state.food.map((c) => ({ c, kind: "food" as const })),
      ...state.meat.map((c) => ({ c, kind: "meat" as const })),
      ...state.swords.map((c) => ({ c, kind: "sword" as const })),
    ];
    if (want.length === live.length) return;
    for (const p of live) pickups.remove(p.mesh);
    live = [];
    for (const { c, kind } of want) {
      if (kind === "sword") addPickup(c, makeSword(), 0.85);
      else if (kind === "meat") addPickup(c, makeMeat(), 0.5);
      else addPickup(c, makeFood(), 0.5);
    }
  }

  // --- the maze ------------------------------------------------------------
  let builtMaze: Maze | null = null;
  let walls: THREE.InstancedMesh | null = null;
  let floor: THREE.Mesh | null = null;
  let ceiling: THREE.Mesh | null = null;
  const braziers: THREE.PointLight[] = [];

  function buildMaze(maze: Maze): void {
    if (walls) {
      level.remove(walls);
      walls.dispose();
    }
    if (floor) level.remove(floor);
    if (ceiling) level.remove(ceiling);
    for (const b of braziers) level.remove(b);
    braziers.length = 0;

    // Each shared edge is one wall: take north and west from every cell, and
    // the south and east edges only where the maze runs out.
    const segments: { pos: THREE.Vector3; scale: THREE.Vector3 }[] = [];
    const long = CELL + WALL_THICKNESS;
    for (let y = 0; y < maze.height; y += 1) {
      for (let x = 0; x < maze.width; x += 1) {
        const at = worldOf({ x, y });
        if (!isOpen(maze, { x, y }, 0)) {
          segments.push({
            pos: new THREE.Vector3(at.x, WALL_HEIGHT / 2, at.z - CELL / 2),
            scale: new THREE.Vector3(long, WALL_HEIGHT, WALL_THICKNESS),
          });
        }
        if (!isOpen(maze, { x, y }, 3)) {
          segments.push({
            pos: new THREE.Vector3(at.x - CELL / 2, WALL_HEIGHT / 2, at.z),
            scale: new THREE.Vector3(WALL_THICKNESS, WALL_HEIGHT, long),
          });
        }
        if (y === maze.height - 1) {
          segments.push({
            pos: new THREE.Vector3(at.x, WALL_HEIGHT / 2, at.z + CELL / 2),
            scale: new THREE.Vector3(long, WALL_HEIGHT, WALL_THICKNESS),
          });
        }
        if (x === maze.width - 1) {
          segments.push({
            pos: new THREE.Vector3(at.x + CELL / 2, WALL_HEIGHT / 2, at.z),
            scale: new THREE.Vector3(WALL_THICKNESS, WALL_HEIGHT, long),
          });
        }
      }
    }

    walls = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      stone,
      segments.length,
    );
    walls.castShadow = true;
    walls.receiveShadow = true;
    const m = new THREE.Matrix4();
    segments.forEach((s, i) => {
      m.compose(
        s.pos,
        new THREE.Quaternion(),
        s.scale,
      );
      walls?.setMatrixAt(i, m);
    });
    const tint = new THREE.Color();
    for (let i = 0; i < segments.length; i += 1) {
      const v = 0.82 + Math.random() * 0.3;
      tint.setRGB(v, v * 0.97, v * 0.92);
      walls.setColorAt(i, tint);
    }
    walls.instanceMatrix.needsUpdate = true;
    if (walls.instanceColor) walls.instanceColor.needsUpdate = true;
    level.add(walls);

    const w = maze.width * CELL;
    const h = maze.height * CELL;
    const centre = new THREE.Vector3((w - CELL) / 2, 0, (h - CELL) / 2);

    floorMat.map?.repeat.set(maze.width, maze.height);
    floor = new THREE.Mesh(new THREE.PlaneGeometry(w + CELL, h + CELL), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(centre.x, 0, centre.z);
    floor.receiveShadow = true;
    level.add(floor);

    ceiling = new THREE.Mesh(
      new THREE.PlaneGeometry(w + CELL, h + CELL),
      new THREE.MeshStandardMaterial({ color: 0x1a1712, roughness: 1 }),
    );
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(centre.x, WALL_HEIGHT, centre.z);
    level.add(ceiling);

    // Wall torches: mood, and enough light to navigate by. Unshadowed and
    // few — shadow-casting point lights are cube maps and cost real frames.
    const spacing = Math.max(2, Math.floor(Math.min(maze.width, maze.height) / 2));
    for (let y = 1; y < maze.height; y += spacing) {
      for (let x = 1; x < maze.width; x += spacing) {
        if (braziers.length >= 8) break;
        const at = worldOf({ x, y });
        const light = new THREE.PointLight(0xff9a3c, 7, 9, 2);
        light.position.set(at.x, 2.3, at.z);
        level.add(light);
        braziers.push(light);
      }
    }

    builtMaze = maze;
  }

  // --- drawing the space between -------------------------------------------
  // The grid is the truth. These read the move already in progress and draw it
  // at constant velocity, so a step looks like walking rather than a lurch.
  const from = new THREE.Vector3();
  const to = new THREE.Vector3();
  let flicker = 0;
  /** 0 upright, 1 flat on the floor. The death you were never shown before. */
  let down = 0;

  /** 0 at the moment a move begins, 1 when it lands. */
  function progress(cooldown: number, duration: number): number {
    if (duration <= 0) return 1;
    return THREE.MathUtils.clamp(1 - cooldown / duration, 0, 1);
  }

  /**
   * Yaw across a turn. A 180 is the awkward case: the shortest path is exactly
   * pi and the sign is a coin toss, so it must be chosen rather than computed
   * or the camera picks a different way round on identical inputs.
   */
  function yawBetween(a: Dir, b: Dir, t: number): number {
    const start = yawOf(a);
    let step = angleDelta(start, yawOf(b));
    if (Math.abs(Math.abs(step) - Math.PI) < 1e-6) step = -Math.PI;
    return start + step * t;
  }

  /**
   * Sizing is checked every frame rather than driven by an event.
   *
   * A one-shot resize at startup rendered a black screen roughly three times
   * in four at 390x844 and never once at 1920x1080 — the canvas has no layout
   * yet when the module runs, so the drawing buffer got fixed at 1x1 and
   * whether anything corrected it was a race. Comparing against the live box
   * each frame costs two integer compares and cannot lose that race.
   */
  const measured = new THREE.Vector2();

  function resize(): void {
    // innerWidth/innerHeight as the floor: the canvas is position:fixed,
    // inset:0, so it IS the viewport, and those are readable before layout.
    const width = Math.max(1, canvas.clientWidth || window.innerWidth);
    const height = Math.max(1, canvas.clientHeight || window.innerHeight);
    renderer.getSize(measured);
    if (measured.x === width && measured.y === height) return;

    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.fov = verticalFov(camera.aspect);
    // Both, always: setSize alone leaves the projection stale and the view
    // stretched, which looks like a CSS bug and isn't.
    camera.updateProjectionMatrix();
  }

  function update(state: GameState, dt: number, look = 0): void {
    resize();

    if (builtMaze !== state.maze) {
      buildMaze(state.maze);
      live = [];
      for (const child of [...pickups.children]) pickups.remove(child);
    }

    // Position and heading both come from the move the rules already started.
    const walked = progress(state.playerCooldown, state.moveFor);
    from.copy(worldOf(state.playerFrom));
    to.copy(worldOf(state.player));
    from.lerp(to, walked);

    // The body is on the grid; the head is not. `look` is a free yaw offset,
    // so you can glance down a side corridor without committing your feet to
    // it — which is the whole reason the turn/step rhythm stopped feeling like
    // a chore. It never changes where you are, so the rules stay untouched.
    down = state.status === "dying" ? Math.min(1, down + dt / 0.55) : 0;
    const fell = down * down;

    camera.position.set(from.x, EYE_HEIGHT - fell * (EYE_HEIGHT - 0.42), from.z);
    camera.rotation.set(
      -fell * 0.5,
      yawBetween(state.facingFrom, state.facing, walked) + look,
      fell * 0.42,
      "YXZ",
    );

    flicker += dt;
    const wobble = 1 + Math.sin(flicker * 11) * 0.06 + Math.sin(flicker * 3.7) * 0.04;
    carried.position.copy(camera.position);
    carried.intensity = (isArmed(state) ? 12 : 8) * wobble;
    carried.color.setHex(isArmed(state) ? 0xbcd4ff : 0xffc789);

    if (state.minotaur) {
      beast.visible = true;
      const stalked = progress(state.minotaurCooldown, MINOTAUR_STEP_SECONDS);
      from.copy(worldOf(state.minotaurFrom ?? state.minotaur));
      to.copy(worldOf(state.minotaur));
      from.lerp(to, stalked);
      beast.position.set(from.x, 0, from.z);
      beast.lookAt(camera.position.x, 0, camera.position.z);
      torch.intensity = 18 * wobble;
    } else {
      beast.visible = false;
      torch.intensity = 0;
    }

    const exit = worldOf(state.exit);
    beacon.position.set(exit.x, 2.2, exit.z);
    doorway.position.set(exit.x, 0.06, exit.z);
    doorLight.position.set(exit.x, 1.5, exit.z);

    syncPickups(state);
    for (const p of live) {
      p.mesh.rotation.y += dt * 1.6;
      // A little bob, so a pickup reads as an object placed there rather than
      // a decal on the floor.
      p.mesh.position.y = p.rest + Math.sin(flicker * 2.2 + p.cell.x + p.cell.y) * 0.08;
    }

    renderer.render(scene, camera);
  }

  function dispose(): void {
    renderer.dispose();
  }

  return { resize, update, dispose };
}
