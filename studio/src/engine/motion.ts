import { Easing } from 'remotion';
import { PACK } from './style';

// How things move, from the pack's `motion`.
export type Ease = (t: number) => number;
const M = PACK.motion;

/** Arrivals. */
export const reveal: Ease = Easing.bezier(...M.reveal.bezier);
/** Leaving: slow to start, then quick. */
export const leave: Ease = Easing.bezier(...M.leave);
/** A move between two resting states. */
export const glide: Ease = Easing.bezier(...M.glide);
/** Frames per arriving line, and between lines. */
export const REVEAL = { dur: M.reveal.frames, stagger: M.reveal.stagger } as const;

export const clamp = (x: number, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const invLerp = (a: number, b: number, x: number) => clamp((x - a) / (b - a));
export const linear: Ease = (t) => t;
export const expoOut: Ease = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

/** Eased 0..1 progress of frame f through [a, b]. */
export const tw = (f: number, a: number, b: number, ease: Ease = linear) => ease(invLerp(a, b, f));

/** The landing spring: 0 -> 1 with the pack's overshoot, from rest at t = 0. */
export const spring01 = (t: number, w = M.spring.w, z = M.spring.z) => {
  if (t <= 0) return 0;
  const wd = w * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t));
};

/** The punch-in on a stressed word: 1 -> 1 + amount over the pack's frames, held. */
export const punch = (f: number, at: number, amount: number = M.punch.amount) => 1 + amount * tw(f, at, at + M.punch.frames, expoOut);

/** A damped kick: 0 at t = 0, rings and decays. For shakes and recoil. */
export const ring = (t: number, freq = 0.18, decay = 6) => (t <= 0 ? 0 : Math.sin(t * freq * Math.PI * 2) * Math.exp(-t / decay));
