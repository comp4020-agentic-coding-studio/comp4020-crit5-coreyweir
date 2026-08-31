// The scene. The ONLY file that imports `three`.
//
// It reads game state and draws it. It never decides anything: the grid is the
// truth, and everything here interpolates toward it.

import * as THREE from "three";

import { type Vec, delta } from "./grid";
import { type Maze, isOpen } from "./maze";
import { type GameState, isArmed } from "./game";

const CELL = 4;
const WALL_HEIGHT = 3.6;
const WALL_THICKNESS = 0.5;
const EYE_HEIGHT = 1.65;

/**
 * The phone viewport is 390x844 portrait. `PerspectiveCamera.fov` is the
 * VERTICAL field of view, so a fixed fov there would narrow the horizontal view
 * to a letterbox and you'd never see a minotaur in a side corridor. Hold the
 * horizontal angle steady instead and derive the vertical one.
 */
const TARGET_HORIZONTAL_FOV = 88;

function verticalFov(aspect: number): number {
  const h = (TARGET_HORIZONTAL_FOV * Math.PI) / 180;
  const v = 2 * Math.atan(Math.tan(h / 2) / aspect);
  return THREE.MathUtils.clamp((v * 180) / Math.PI, 45, 118);
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
}

export interface Renderer {
  /** Idempotent; called every frame. */
  resize(): void;
  update(state: GameState, dt: number): void;
  dispose(): void;
}

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05060a);
  // Fog does the mood work cheaply, and hides the far edge of the maze.
  scene.fog = new THREE.FogExp2(0x05060a, 0.055);

  const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 200);
  camera.position.y = EYE_HEIGHT;

  scene.add(new THREE.AmbientLight(0x46536e, 0.85));

  // Your own light, kept short-range: enough to read the walls beside you,
  // not enough to floodlight the maze.
  const carried = new THREE.PointLight(0xffc789, 26, 14, 1.8);
  carried.position.y = EYE_HEIGHT;
  scene.add(carried);

  /** Mottled noise, drawn once. Cheaper than shipping an image and it tiles. */
  function stoneTexture(base: string, speckle: string): THREE.CanvasTexture {
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = speckle;
      for (let i = 0; i < 2600; i += 1) {
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

  const stone = new THREE.MeshStandardMaterial({
    map: stoneTexture("#8d8479", "#3a3129"),
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
    new THREE.BoxGeometry(1.5, 2.4, 1.2),
    new THREE.MeshStandardMaterial({ color: 0x2b1d18, roughness: 0.9 }),
  );
  body.position.y = 1.2;
  body.castShadow = true;
  beast.add(body);
  const horns = new THREE.Mesh(
    new THREE.BoxGeometry(2.1, 0.22, 0.22),
    new THREE.MeshStandardMaterial({ color: 0xd8cdb4, roughness: 0.6 }),
  );
  horns.position.y = 2.3;
  beast.add(horns);
  const flame = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 10, 10),
    new THREE.MeshBasicMaterial({ color: 0xffb347 }),
  );
  flame.position.set(0.85, 1.9, 0);
  beast.add(flame);
  // The one light that earns a shadow map: it is what makes the torch bleed
  // around a corner instead of shining through the wall.
  const torch = new THREE.PointLight(0xffa542, 55, 26, 2);
  torch.position.set(0.85, 1.9, 0);
  torch.castShadow = true;
  torch.shadow.mapSize.set(512, 512);
  torch.shadow.camera.near = 0.4;
  torch.shadow.camera.far = 26;
  torch.shadow.bias = -0.004;
  beast.add(torch);
  scene.add(beast);

  // --- the way out ---------------------------------------------------------
  // depthTest off so it draws over the walls: you always know WHERE, never HOW.
  /** A soft radial glow. Daylight seen from inside a hill, not a strip light. */
  function glowTexture(): THREE.CanvasTexture {
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0, "rgba(190,255,205,0.85)");
      g.addColorStop(0.35, "rgba(90,220,130,0.32)");
      g.addColorStop(1, "rgba(60,190,110,0)");
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
      map: glowTexture(),
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      fog: false,
    }),
  );
  beacon.scale.set(7, 7, 1);
  beacon.renderOrder = 999;
  scene.add(beacon);

  const doorway = new THREE.Mesh(
    new THREE.BoxGeometry(CELL * 0.8, 0.1, CELL * 0.8),
    new THREE.MeshBasicMaterial({ color: 0x4fd987 }),
  );
  doorway.position.y = 0.06;
  scene.add(doorway);
  const doorLight = new THREE.PointLight(0x7dffa8, 16, 7, 2);
  doorLight.position.y = 1.5;
  scene.add(doorLight);

  // --- pickups -------------------------------------------------------------
  const pickups = new THREE.Group();
  scene.add(pickups);
  let live: Pickup[] = [];

  const foodGeo = new THREE.IcosahedronGeometry(0.42, 0);
  const foodMat = new THREE.MeshStandardMaterial({
    color: 0xe4c15a,
    emissive: 0x6a4b12,
    roughness: 0.6,
  });
  const meatMat = new THREE.MeshStandardMaterial({
    color: 0xa8434b,
    emissive: 0x3a1013,
    roughness: 0.7,
  });
  const swordGeo = new THREE.BoxGeometry(0.14, 1.7, 0.14);
  const swordMat = new THREE.MeshStandardMaterial({
    color: 0xdfe9ff,
    emissive: 0x5b7fc7,
    emissiveIntensity: 1.4,
    roughness: 0.25,
    metalness: 0.8,
  });

  function addPickup(
    cell: Vec,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    y: number,
  ): void {
    const mesh = new THREE.Mesh(geo, mat);
    const at = worldOf(cell);
    mesh.position.set(at.x, y, at.z);
    pickups.add(mesh);
    live.push({ mesh, cell });
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
      if (kind === "sword") addPickup(c, swordGeo, swordMat, 1.1);
      else addPickup(c, foodGeo, kind === "meat" ? meatMat : foodMat, 0.55);
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
        const light = new THREE.PointLight(0xff9a3c, 22, 15, 2);
        light.position.set(at.x, 2.6, at.z);
        level.add(light);
        braziers.push(light);
      }
    }

    builtMaze = maze;
  }

  // --- camera smoothing ----------------------------------------------------
  // The grid is the truth; these ease toward it so movement doesn't teleport.
  let camPos = new THREE.Vector3();
  let camYaw = 0;
  let beastPos = new THREE.Vector3();
  let started = false;
  let flicker = 0;

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

  function update(state: GameState, dt: number): void {
    resize();

    if (builtMaze !== state.maze) {
      buildMaze(state.maze);
      started = false;
      live = [];
      for (const child of [...pickups.children]) pickups.remove(child);
    }

    const target = worldOf(state.player);
    const targetYaw = yawOf(state.facing);

    if (!started) {
      camPos = target.clone();
      camYaw = targetYaw;
      beastPos = state.minotaur ? worldOf(state.minotaur) : target.clone();
      started = true;
    }

    // Exponential smoothing, framerate-independent.
    const ease = 1 - Math.exp(-dt * 13);
    camPos.lerp(target, ease);
    camYaw += angleDelta(camYaw, targetYaw) * (1 - Math.exp(-dt * 11));

    camera.position.set(camPos.x, EYE_HEIGHT, camPos.z);
    camera.rotation.set(0, camYaw, 0, "YXZ");

    flicker += dt;
    const wobble = 1 + Math.sin(flicker * 11) * 0.06 + Math.sin(flicker * 3.7) * 0.04;
    carried.position.set(camPos.x, EYE_HEIGHT, camPos.z);
    carried.intensity = (isArmed(state) ? 36 : 26) * wobble;
    carried.color.setHex(isArmed(state) ? 0xbcd4ff : 0xffc789);

    if (state.minotaur) {
      beast.visible = true;
      beastPos.lerp(worldOf(state.minotaur), 1 - Math.exp(-dt * 9));
      beast.position.set(beastPos.x, 0, beastPos.z);
      beast.lookAt(camera.position.x, 0, camera.position.z);
      torch.intensity = 55 * wobble;
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
    }

    renderer.render(scene, camera);
  }

  function dispose(): void {
    renderer.dispose();
  }

  return { resize, update, dispose };
}
