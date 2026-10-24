import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { luminance, onColour } from '../engine/colour';
import { expoOut, ring, spring01, tw } from '../engine/motion';
import { packColour, PACK, requireScene, voice } from '../engine/style';
import { textWidth } from '../engine/text';
import { EVEN, wordPopInk, wordPopKey } from '../kit/contrast';
import { Mark } from '../kit/Mark';
import { FullFrame, type Shoot } from '../kit/Presenter';

/** The row the words share: the frame less its 50 px sides. */
const ROW = 980;

// Word-pop captions: a scene type a pack brings (Volt). The spoken words are the show: each pops in on its own, big and
// centred over the speaker, landing on the pack's spring; the key word lands on the subtitle key box, with a quick
// punch-in on him (blurred a little while it travels), a soft flash in the pack's flash colour and a small shake.
// `energy` sets how hard all of that hits: 1 is the full slam, the default a good deal calmer. It reads everything
// else from the pack, and asks the pack first: a pack that doesn't bring it can't render it.

/** How hard word-pop hits by default: the arrival overshoot, tilt, punch-in, blur, shake and flash all scale with it. */
export const WORD_POP_ENERGY = 0.45;

export type PopWord = { text: string; at: number; key?: boolean };
/** Words on screen together, from frame `from` to `to`. */
export type PopGroup = { from: number; to: number; words: PopWord[] };

/** The key word's box when the captions have none to lend (the pack asks for a box anyway). */
const DEFAULT_BOX = { colour: 'hero', radius: 12, padX: 0.2, padY: 0.06, tilt: -2.5 };

const Pop: React.FC<{ w: PopWord; f: number; size: number; i: number; energy: number; ink: { fill: string; edge: string } }> = ({ w, f, size, i, energy: e, ink }) => {
  const s = spring01(f - w.at);
  const keyStyle = wordPopKey();
  const pad = w.key && keyStyle === 'box' ? 2 * (PACK.subtitles.key.box ?? DEFAULT_BOX).padX : 0;
  // it arrives bigger and settles, but never wider than the row: a long word on a wide face would run off the frame
  const most = ROW / ((textWidth(w.text.toUpperCase(), 1, 'display') + pad) * size);
  const scale = Math.min(1 + 0.7 * e * (1 - s), Math.max(1, most));
  const tilt = (w.key ? -3 : i % 2 ? 2.5 : -2) * (1 - s) * 2 * e + (w.key ? -3 * (0.4 + 0.6 * e) : 0);
  const word: React.CSSProperties = {
    ...voice('display', size, { lh: 1.05, caseAsked: 'uppercase' }),
    display: 'inline-block',
    transform: `scale(${scale.toFixed(3)}) rotate(${tilt.toFixed(2)}deg)`,
    transformOrigin: '50% 60%',
  };
  // bare words take the ink the footage under them calls for, with an edge in the opposite tone (src/kit/contrast.ts)
  const bare: React.CSSProperties = { WebkitTextStroke: `${Math.round(size * 0.07)}px ${ink.edge}`, paintOrder: 'stroke fill', textShadow: `0 ${Math.round(size * 0.04)}px 0 ${ink.edge === '#000000' ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.8)'}` };
  if (w.key && keyStyle === 'marker') {
    // a marker stroke behind the word, the word in ink on it
    return (
      <span style={{ ...word, color: PACK.palette.ink }}>
        <Mark kind="highlight" hero={packColour('hero')} at={w.at} seed={53}>{w.text}</Mark>
      </span>
    );
  }
  if (w.key && keyStyle === 'box') {
    const box = PACK.subtitles.key.box ?? DEFAULT_BOX;
    const fill = packColour(box.colour);
    const border = PACK.subtitles.key.box?.border;
    return (
      <span
        style={{
          ...word, color: onColour(fill), background: fill, borderRadius: box.radius, padding: `${box.padY}em ${box.padX}em`,
          boxShadow: [border ? `inset 0 0 0 ${border.width}px ${packColour(border.colour)}` : '', `0 ${Math.round(4 + 6 * e)}px 0 rgba(0,0,0,0.8)`].filter(Boolean).join(', '),
        }}
      >
        {w.text}
      </span>
    );
  }
  if (w.key) {
    const h = packColour('hero');
    return <span style={{ ...word, ...bare, color: h, WebkitTextStroke: `${Math.round(size * 0.07)}px ${luminance(h) > EVEN ? '#000000' : '#FFFFFF'}` }}>{w.text}</span>;
  }
  return <span style={{ ...word, ...bare, color: ink.fill }}>{w.text}</span>;
};

export const WordPop: React.FC<{ shoot: Shoot; at: number; groups: PopGroup[]; k?: number; crownY?: number; y?: number; size?: number; energy?: number }> = ({
  shoot, at, groups, k = 1.78, crownY = 420, y = 1340, size = 150, energy = WORD_POP_ENERGY,
}) => {
  requireScene('word-pop');
  const f = useCurrentFrame();
  const key = groups.flatMap((g) => g.words).find((w) => w.key);
  const P = PACK.motion.punch;
  const kp = key ? tw(f, key.at, key.at + P.frames, expoOut) : 0;
  const moving = key ? f >= key.at && f < key.at + P.frames : false;
  const shake = key ? ring(f - key.at, 0.45, 5) * 16 * energy : 0;
  const fl = PACK.transitions.flash;
  const flash = key && fl.enabled && f >= key.at && f < key.at + fl.frames;
  const g = groups.find((x) => f >= x.from && f < x.to);
  // the scene's size, unless the pack's face is too wide for its longest word to fit the row (a key word with its box)
  const box = wordPopKey() === 'box' ? (PACK.subtitles.key.box ?? DEFAULT_BOX) : null;
  const widest = Math.max(...groups.flatMap((x) => x.words).map((w) => textWidth(w.text.toUpperCase(), 1, 'display') + (w.key && box ? 2 * box.padX : 0)));
  const ink = wordPopInk(shoot);
  const fit = Math.min(size, Math.floor(ROW / (widest * 1.04)));
  // the words sit on his chest, clear of his chin even at the punch-in's full zoom
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <AbsoluteFill style={{ transform: `translate(${shake.toFixed(1)}px, ${(shake * 0.4).toFixed(1)}px)`, filter: moving ? `blur(${(7 * energy).toFixed(1)}px)` : undefined }}>
        <FullFrame shoot={shoot} at={at} k={k} crownY={crownY} zoom={1 + 2 * energy * P.amount * kp} />
      </AbsoluteFill>
      {g && (
        <div style={{ position: 'absolute', left: 50, right: 50, top: y, transform: 'translateY(-50%)', display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: `0 ${Math.round(fit * 0.22)}px` }}>
          {g.words.filter((w) => f >= w.at).map((w, i) => <Pop key={w.text + w.at} w={w} f={f} size={fit} i={i} energy={energy} ink={ink} />)}
        </div>
      )}
      {flash && <AbsoluteFill style={{ background: packColour(fl.colour), opacity: 0.8 * energy }} />}
    </AbsoluteFill>
  );
};
