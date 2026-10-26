import anton from './metrics/anton.json';
import ebGaramond400 from './metrics/eb-garamond-400.json';
import ebGaramond700 from './metrics/eb-garamond-700.json';
import inter500 from './metrics/inter-500.json';
import inter600Italic from './metrics/inter-600-italic.json';
import inter700 from './metrics/inter-700.json';
import inter900 from './metrics/inter-900.json';
import jetbrainsMono from './metrics/jetbrains-mono.json';
import newsreader from './metrics/newsreader.json';
import archivoBlack from './metrics/archivo-black.json';
import caveat400 from './metrics/caveat-400.json';
import caveat700 from './metrics/caveat-700.json';
import sora400 from './metrics/sora-400.json';
import sora700 from './metrics/sora-700.json';
import spaceGrotesk400 from './metrics/space-grotesk-400.json';
import spaceGrotesk700 from './metrics/space-grotesk-700.json';
import virgil from './metrics/virgil.json';
import vt323 from './metrics/vt323.json';
import interTight800 from './metrics/inter-tight-800.json';
import instrumentSerif400Italic from './metrics/instrument-serif-400-italic.json';

// Letter metrics for every face a pack can name (scripts/font_metrics.py writes them; register new ones here).
export type Metrics = {
  [weight: string]: { advance: Record<string, number>; kern: Record<string, number> } | number;
} & { capHeight: number; xHeight: number; ascent: number; descent: number };

const m = (x: unknown) => x as Metrics;

export const METRICS: Record<string, Metrics> = {
  anton: m(anton),
  'inter-500': m(inter500),
  'inter-600-italic': m(inter600Italic),
  'inter-700': m(inter700),
  'inter-900': m(inter900),
  'eb-garamond-400': m(ebGaramond400),
  'eb-garamond-700': m(ebGaramond700),
  newsreader: m(newsreader),
  'jetbrains-mono': m(jetbrainsMono),
  'caveat-400': m(caveat400),
  'caveat-700': m(caveat700),
  virgil: m(virgil),
  vt323: m(vt323),
  'inter-tight-800': m(interTight800),
  'instrument-serif-400-italic': m(instrumentSerif400Italic),
  'sora-400': m(sora400),
  'sora-700': m(sora700),
  'archivo-black': m(archivoBlack),
  'space-grotesk-400': m(spaceGrotesk400),
  'space-grotesk-700': m(spaceGrotesk700),
};

/** A face's advance table (em) at its first weight. */
export const advances = (key: string) => {
  const mt = METRICS[key];
  const w = Object.keys(mt).find((k) => /^\d+$/.test(k))!;
  return (mt[w] as { advance: Record<string, number> }).advance;
};
