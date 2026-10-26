import { cancelRender, continueRender, delayRender, staticFile } from 'remotion';
import { REFERENCE } from './reference';
import { PACK, VOICES, voiceAdjust, voiceFamily } from './style';

// The pack's faces, loaded before any frame renders. Each voice gets its own copy of its face, scaled by the size rule
// (a CSS size-adjust) and given the reference face's ascent, descent and line gap, so it stands as tall as the
// reference and sits on the same baseline in its line box (src/engine/reference.ts). Chrome scales those overrides by
// size-adjust too, hence the divide. A voice with `match: none` uses the face as it is.

const fonts = document.fonts as unknown as { add: (f: FontFace) => void };

const load = (family: string, file: string, weight: string, style: string, a: number) => {
  const handle = delayRender(`Loading font ${family}`);
  const pct = (v: number) => `${((v / a) * 100).toFixed(3)}%`;
  // size-adjust is newer than this TypeScript's DOM types (Chrome has had it since 92)
  const descriptors = a === 1 ? { weight, style } : {
    weight, style, sizeAdjust: `${(a * 100).toFixed(3)}%`,
    ascentOverride: pct(REFERENCE.ascent), descentOverride: pct(REFERENCE.descent), lineGapOverride: pct(REFERENCE.lineGap),
  };
  return new FontFace(family, `url(${staticFile(file)})`, descriptors as FontFaceDescriptors)
    .load()
    .then((f) => { fonts.add(f); continueRender(handle); })
    .catch((e) => cancelRender(e));
};

// A variable face with an optical-size axis (Newsreader) would otherwise pick its design from the font size and set
// wider or narrower than its letter metrics, which are measured at its default optical size. Pinned here, once.
const style = document.createElement('style');
style.textContent = '* { font-optical-sizing: none !important; }';
document.head.appendChild(style);

const done = new Set<string>();
const pending: Promise<void>[] = [];
for (const v of VOICES) {
  const family = voiceFamily(v);
  if (done.has(family)) continue;
  done.add(family);
  for (const f of PACK.fonts.filter((x) => x.family === PACK.type[v].family)) pending.push(load(family, f.file, f.weight, f.style ?? 'normal', voiceAdjust(v)));
}

// document.fonts.ready alone can resolve before these FontFace.load() calls add
// their faces to the set. Live preview waits for the actual loading promises.
export const fontsReady = Promise.all(pending);
