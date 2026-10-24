import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { onColour } from '../engine/colour';
import { expoOut, ring, spring01, tw } from '../engine/motion';
import { packColour, PACK, requireScene, voice } from '../engine/style';
import { textWidth } from '../engine/text';
import { Icon } from '../kit/Icon';
import { FULL, FullFrame, headIn, type Shoot } from '../kit/Presenter';

// The sticker: a scene type a pack brings (Pop). The presenter full frame, and stickers slapped on around their head
// one by one on the spoken words: a phrase on an ink-bordered tag, a number in a starburst, an icon stuck to a corner.
// Each lands big and tilted, settles on the pack's spring and kicks the whole frame with a small shake; a struck one
// gets crossed out in the hero colour as the next lands. They keep off the face and the caption lane.

export type StickerItem = { text: string; at: number; kind?: 'tag' | 'burst'; icon?: string; strike?: boolean };
export type StickerProps = { shoot: Shoot; at: number; stickers: StickerItem[] };

const INK = () => PACK.palette.ink;
/** A tag's icon: its size, how far it hangs off the tag's top-right corner, and the room the tag keeps for it on its right. */
const ICON = { size: 130, out: 70, room: 56 };

/** A starburst's outline: n spikes round a centre, in a box of side 2r. */
const burst = (r: number, n = 16) =>
  Array.from({ length: n * 2 }, (_, i) => {
    const a = (Math.PI * i) / n - Math.PI / 2;
    const k = i % 2 ? 0.8 : 1;
    return `${(r + Math.cos(a) * r * k).toFixed(1)},${(r + Math.sin(a) * r * k).toFixed(1)}`;
  }).join(' ');

/**
 * Where the stickers go, in order: above the head on one side, above it on the other, and low beside the chest. The two
 * above the head share the frame's width, so each takes at most `room` px of it.
 */
const slots = (head: ReturnType<typeof headIn>) => {
  const side = head.x <= 540 ? 1 : -1;
  return [
    { x: head.x - side * 230, y: Math.max(250, head.crown - 120), tilt: -7 * side, room: 470 },
    { x: head.x + side * 300, y: Math.max(250, head.crown - 150), tilt: 6 * side, room: 470 },
    { x: head.x + side * 250, y: Math.min(1290, head.chin + 150), tilt: -4 * side, room: 680 },
  ];
};

const Slap: React.FC<{ s: StickerItem; f: number; x: number; y: number; tilt: number; room: number; struck: number }> = ({ s, f, x, y, tilt, room, struck }) => {
  const p = spring01(f - s.at);
  const scale = 1 + 0.9 * (1 - p);
  const ink = INK();
  const hero = packColour('hero');
  const shadow = `drop-shadow(10px 10px 0 ${ink})`;
  if (s.kind === 'burst') {
    const size = Math.min(190, Math.floor(300 / textWidth(s.text, 1, 'display')));
    const r = Math.max(185, (textWidth(s.text, size, 'display') + 100) / 2);
    const cx = Math.min(1080 - 30 - r, Math.max(30 + r, x));
    return (
      <div style={{ position: 'absolute', left: cx - r, top: y - r, width: r * 2, height: r * 2, transform: `rotate(${(tilt + 14 * (1 - p)).toFixed(2)}deg) scale(${scale.toFixed(3)})`, filter: shadow }}>
        <svg width={r * 2} height={r * 2} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
          <polygon points={burst(r)} fill={hero} stroke={ink} strokeWidth={7} strokeLinejoin="round" />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', ...voice('display', size, { lh: 1 }), color: onColour(hero, ink, '#FFFFFF') }}>{s.text}</div>
      </div>
    );
  }
  // a tag with an icon keeps room for it on its right, so the icon on its corner never sits over the words
  const pad = s.icon ? ICON.room : 0;
  const size = Math.min(112, Math.floor((room - 72 - (s.icon ? ICON.room + ICON.out : 0)) / textWidth(s.text, 1, 'display')));
  const w = textWidth(s.text, size, 'display') + 72 + pad;
  const h = size * 0.7 + 72;
  // kept inside the frame, with room for its shadow and its icon
  const cx = Math.min(1080 - 40 - w / 2 - (s.icon ? ICON.out : 0), Math.max(40 + w / 2, x));
  return (
    <div style={{ position: 'absolute', left: cx - w / 2, top: y - h / 2, width: w, height: h, transform: `rotate(${(tilt - 10 * (1 - p)).toFixed(2)}deg) scale(${scale.toFixed(3)})`, filter: shadow }}>
      <div style={{ position: 'absolute', inset: 0, background: PACK.cards.light.fill, borderRadius: Math.min(16, PACK.cards.light.radius * 0.6), boxShadow: `inset 0 0 0 6px ${ink}` }} />
      <div style={{ position: 'absolute', inset: 0, paddingRight: pad, display: 'flex', alignItems: 'center', justifyContent: 'center', ...voice('display', size, { lh: 1 }), color: ink, whiteSpace: 'nowrap' }}>{s.text}</div>
      {s.strike && struck > 0 && (
        <div style={{ position: 'absolute', left: -14, top: h / 2 - 7, width: (w - pad + 28) * struck, height: 14, background: hero, boxShadow: `0 0 0 4px ${ink}`, transform: 'rotate(-6deg)', transformOrigin: '0 50%' }} />
      )}
      {s.icon && (
        <div style={{ position: 'absolute', right: -ICON.out, top: -76, transform: `rotate(${12 - tilt}deg)` }}>
          <Icon name={s.icon} size={ICON.size} colour={ink} hero={hero} knock={PACK.cards.light.fill} />
        </div>
      )}
    </div>
  );
};

export const Sticker: React.FC<StickerProps> = ({ shoot, at, stickers }) => {
  requireScene('sticker');
  const f = useCurrentFrame();
  const head = headIn(shoot);
  const places = slots(head);
  const shake = stickers.reduce((a, s) => a + ring(f - s.at, 0.45, 4) * 14, 0);
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <AbsoluteFill style={{ transform: `translate(${shake.toFixed(1)}px, ${(-shake * 0.6).toFixed(1)}px)` }}>
        <FullFrame shoot={shoot} at={at} k={FULL.k} crownY={FULL.crownY} />
        {stickers.slice(0, 3).map((s, i) =>
          f >= s.at ? (
            // a struck sticker is crossed out as the next one lands (or soon after its own, if it's the last)
            <Slap key={i} s={s} f={f} {...places[i]} struck={tw(f, (stickers[i + 1]?.at ?? s.at + 16) - 4, (stickers[i + 1]?.at ?? s.at + 16) + 4, expoOut)} />
          ) : null,
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
