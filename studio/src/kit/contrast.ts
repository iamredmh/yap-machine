import { luminance } from '../engine/colour';
import { P, packColour, PACK } from '../engine/style';
import type { Shoot } from './Presenter';

// Type straight on footage, with no box behind it: what's under it decides its colour. A pack's caption colour is
// chosen for its own backing (a white box wants ink), so on bare footage it has to be checked against the footage.

/** The relative luminance where black and white type read equally well (their WCAG contrast meets at about 0.179). */
export const EVEN = 0.179;

/**
 * The type for words over this footage: light footage (a white shirt) takes the pack's type for light grounds, dark
 * footage the type for dark grounds, swapped for white or ink if that colour doesn't read there; and always an edge
 * in the opposite tone, so it holds where the footage varies. Footage with no tone measured counts as dark.
 */
export const overFootage = (shoot?: Shoot | null) => {
  const light = (shoot?.tone?.chest ?? 0.05) > EVEN;
  const S = PACK.subtitles;
  const want = light ? S.colour.light : S.colour.dark;
  const fill = light ? (luminance(want) < 0.12 ? want : P.ink) : luminance(want) > 0.45 ? want : '#FFFFFF';
  return { light, fill, edge: light ? '#FFFFFF' : '#000000' };
};

/** Word-pop's words, as the pack asks: auto (overFootage), white, black or the hero colour, each with an opposite edge. */
export const wordPopInk = (shoot?: Shoot | null) => {
  const w = PACK.wordPop?.words ?? 'auto';
  if (w === 'white') return { fill: '#FFFFFF', edge: '#000000' };
  if (w === 'black') return { fill: P.ink, edge: '#FFFFFF' };
  if (w === 'hero') {
    const h = packColour('hero');
    return { fill: h, edge: luminance(h) > EVEN ? '#000000' : '#FFFFFF' };
  }
  return overFootage(shoot);
};

/** How word-pop marks its key word: the pack's choice, else the way its captions mark theirs. */
export const wordPopKey = (): 'box' | 'marker' | 'colour' => {
  const k = PACK.wordPop?.key;
  if (k) return k;
  const S = PACK.subtitles.key;
  return S.box ? 'box' : S.mark === 'highlight' ? 'marker' : 'colour';
};
