import { mixHex } from '../engine/colour';
import { HERO, P, PACK } from '../engine/style';
import type { Theme } from './Ground';

/** The ground a scene stands on: the one it asks for, else the pack's. */
export const groundOf = (asked?: Theme): Theme => asked ?? PACK.composition.ground;

/** Type colours on a ground: headlines, the step-back colour, labels, and this video's hero colour. */
export const tones = (theme: Theme) => {
  const dark = theme === 'dark';
  const head = dark ? P.text : P.ink;
  const soft = dark ? P.textSoft : P.inkSoft;
  return { dark, head, soft, label: mixHex(soft, dark ? P.base : '#FFFFFF', 0.15), hero: HERO, rule: dark ? P.line : mixHex(P.ink, '#FFFFFF', 0.82) };
};
