import type { Signature } from './pack';
import { PACK } from './style';

// The pack's signature (src/engine/pack.ts), with the kit's own drawing for anything it leaves out, so a pack without
// one draws exactly as before.

export const SIGNATURE_DEFAULTS: Signature = {
  surface: 'solid',
  mark: 'none',
  icons: 'none',
  reveal: 'rise',
  chrome: 'none',
  edge: 'straight',
  tilt: 0,
  rough: 0,
  boil: 0,
};

export const SIG: Signature = { ...SIGNATURE_DEFAULTS, ...PACK.signature };

/** The seed a hand-drawn stroke uses at frame f: it changes every `boil` frames, so the drawing shimmers like a flip book. */
export const boilSeed = (f: number, base = 0) => (SIG.boil > 0 ? base + Math.floor(f / SIG.boil) * 7919 : base);
