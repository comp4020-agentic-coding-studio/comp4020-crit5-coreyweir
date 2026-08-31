// Sound, synthesised. No files to load, nothing to wait for.
//
// A game with no instructions has to answer you somehow, and in a corridor you
// cannot see the end of, the ear is the only sense with any range. So: a step
// confirms the key you pressed, a chime confirms the pickup you may not have
// noticed, and the beast is audible through walls long before it is visible
// round a corner. That last one is the same promise as its torch — you know
// *where*, never *how*.
//
// Everything in here diffs two frames of game state. The rules stay deaf.

import { type GameState, isArmed } from "./game";

export interface Audio {
  /** The context starts suspended; this must run inside a real gesture. */
  resume(): void;
  update(state: GameState): void;
  dispose(): void;
}

type Ctor = typeof AudioContext;

export function createAudio(): Audio {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let noise: AudioBuffer | null = null;
  let stalk: GainNode | null = null;
  let prev: GameState | null = null;
  let heart = 0;

  function ensure(): AudioContext | null {
    if (ctx) return ctx;
    const Ctor: Ctor | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;
    if (!Ctor) return null;

    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.45;
    master.connect(ctx.destination);

    const frames = Math.floor(ctx.sampleRate * 0.5);
    noise = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < frames; i += 1) data[i] = Math.random() * 2 - 1;

    // The stalking drone: one continuous voice whose loudness is the distance
    // to the minotaur. Always running, usually silent.
    const growl = ctx.createOscillator();
    growl.type = "sawtooth";
    growl.frequency.value = 41;
    const shaped = ctx.createBiquadFilter();
    shaped.type = "lowpass";
    shaped.frequency.value = 190;
    stalk = ctx.createGain();
    stalk.gain.value = 0;
    growl.connect(shaped).connect(stalk).connect(master);
    growl.start();

    return ctx;
  }

  function tone(
    freq: number,
    seconds: number,
    gain: number,
    type: OscillatorType = "sine",
    slideTo = freq,
    delay = 0,
  ): void {
    if (!ctx || !master) return;
    const at = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    if (slideTo !== freq) osc.frequency.exponentialRampToValueAtTime(slideTo, at + seconds);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(gain, at + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
    osc.connect(env).connect(master);
    osc.start(at);
    osc.stop(at + seconds + 0.02);
  }

  function hiss(seconds: number, gain: number, cutoff: number, delay = 0): void {
    if (!ctx || !master || !noise) return;
    const at = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const band = ctx.createBiquadFilter();
    band.type = "lowpass";
    band.frequency.value = cutoff;
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, at);
    env.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
    src.connect(band).connect(env).connect(master);
    src.start(at);
    src.stop(at + seconds);
  }

  // Footsteps alternate, because two identical steps in a row is the sound of
  // a machine and not of somebody walking.
  let left = false;
  function step(armed: boolean): void {
    left = !left;
    hiss(0.09, 0.16, left ? 900 : 700);
    tone(left ? 96 : 84, 0.1, 0.09, "sine");
    if (armed) tone(left ? 1900 : 2100, 0.07, 0.012, "triangle");
  }

  return {
    resume() {
      const context = ensure();
      if (context && context.state === "suspended") void context.resume();
    },

    update(state) {
      const context = ensure();
      if (!context || context.state !== "running") {
        prev = state;
        return;
      }
      const was = prev;
      prev = state;
      if (!was) return;

      if (was.level !== state.level) {
        // Up and out.
        tone(392, 0.16, 0.14, "triangle");
        tone(523, 0.16, 0.14, "triangle", 523, 0.11);
        tone(784, 0.5, 0.16, "triangle", 784, 0.22);
        return;
      }

      const walking = state.status === "playing" && was.status === "playing";
      if (
        walking &&
        (was.player.x !== state.player.x || was.player.y !== state.player.y)
      ) {
        step(isArmed(state));
      }

      // Killing it and eating what it drops are two different moments and both
      // score, so neither can be detected from the score alone.
      if (was.minotaur && !state.minotaur && state.status === "playing") {
        hiss(0.3, 0.5, 320);
        tone(150, 0.45, 0.24, "sawtooth", 48);
        tone(660, 0.28, 0.1, "sine", 990, 0.24);
      }
      if (state.food.length < was.food.length) {
        tone(587, 0.13, 0.11, "sine", 880);
      }
      if (state.meat.length < was.meat.length) {
        tone(330, 0.22, 0.15, "sine", 494);
        tone(494, 0.26, 0.09, "triangle", 659, 0.1);
      }

      if (state.swords.length < was.swords.length) {
        // Steel: a struck bell, detuned so it rings rather than beeps.
        tone(1245, 0.9, 0.1, "triangle");
        tone(1867, 0.7, 0.055, "triangle");
        tone(2489, 0.5, 0.03, "sine");
      }

      if (state.status === "dying" && was.status !== "dying") {
        hiss(0.5, 0.6, 500);
        tone(220, 0.9, 0.22, "sawtooth", 55);
      }
      if (state.status === "gameOver" && was.status !== "gameOver") {
        hiss(0.7, 0.6, 400);
        tone(165, 2.4, 0.24, "sawtooth", 41);
        tone(110, 2.6, 0.18, "sine", 55, 0.2);
      }
      if (state.status === "won" && was.status !== "won") {
        tone(523, 1.6, 0.16, "triangle");
        tone(659, 1.6, 0.14, "triangle", 659, 0.12);
        tone(784, 1.8, 0.14, "triangle", 784, 0.24);
        tone(1047, 2.2, 0.12, "sine", 1047, 0.36);
      }

      // It roars when it picks up your scent, and again when it turns tail.
      if (state.minotaurMode !== was.minotaurMode && state.minotaur) {
        if (state.minotaurMode === "hunting") {
          tone(180, 0.55, 0.2, "sawtooth", 90);
          hiss(0.35, 0.25, 600);
        } else if (state.minotaurMode === "fleeing") {
          tone(420, 0.4, 0.14, "sawtooth", 840);
        }
      }

      // Distance, as loudness. Manhattan rather than a path length: it is a
      // sound through stone, so it should not care about the corridors.
      if (stalk && state.minotaur && state.status === "playing") {
        const away =
          Math.abs(state.minotaur.x - state.player.x) +
          Math.abs(state.minotaur.y - state.player.y);
        const near = Math.max(0, 1 - away / 7);
        const target = near * near * (state.minotaurMode === "hunting" ? 0.5 : 0.28);
        stalk.gain.setTargetAtTime(target, context.currentTime, 0.25);
      } else if (stalk) {
        stalk.gain.setTargetAtTime(0, context.currentTime, 0.3);
      }

      // Starving: a heartbeat that gets faster the emptier you are. The bar is
      // at the bottom of the screen and your eyes are down a corridor.
      if (state.status === "playing" && state.hunger < 0.3 && state.hunger > 0) {
        const period = 0.4 + state.hunger * 2;
        if (context.currentTime - heart > period) {
          heart = context.currentTime;
          tone(62, 0.16, 0.3, "sine", 44);
          tone(58, 0.14, 0.2, "sine", 40, 0.17);
        }
      }
    },

    dispose() {
      void ctx?.close();
      ctx = null;
    },
  };
}
