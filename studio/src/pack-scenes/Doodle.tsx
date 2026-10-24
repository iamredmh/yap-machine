import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { rgba } from '../engine/colour';
import { tw } from '../engine/motion';
import { boilSeed, SIG } from '../engine/signature';
import { packColour, PACK, requireScene, voice } from '../engine/style';
import { textWidth } from '../engine/text';
import { Mark } from '../kit/Mark';
import { FULL, FullFrame, headIn, type Shoot } from '../kit/Presenter';
import { Rise } from '../kit/Rise';
import { roughLine, roughPoly, roughRect } from '../kit/rough';

// The doodle: a scene type a pack brings (Sketch). The whiteboard drawn onto the footage: the presenter full frame, a
// scrap of paper taped above them with a few handwritten words (the key one on the marker), then an arrow drawn from
// the note down to the side of their head, and three quick strokes of emphasis by the other ear. Everything is drawn
// the signature's way: wobbling, boiling, arriving in steps. It never crosses the face, and the captions run under it.

export type DoodleProps = { shoot: Shoot; at: number; note: string; side?: 'left' | 'right'; from?: number };

/** The note's type size (a reference size) and its padding. */
const SIZE = 96;
const PAD = { x: 46, y: 34 };

/** Points along a quadratic curve, for a hand-drawn arrow's shaft. */
const curve = (a: [number, number], c: [number, number], b: [number, number], n = 8): Array<[number, number]> =>
  Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    return [(1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0], (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1]];
  });

export const Doodle: React.FC<DoodleProps> = ({ shoot, at, note, side, from = 4 }) => {
  requireScene('doodle');
  const f = useCurrentFrame();
  const head = headIn(shoot);
  // the note goes over the side of the frame with more room beside the head, unless the plan says
  const s = side ?? (head.x <= 540 ? 'right' : 'left');
  const dir = s === 'right' ? 1 : -1;
  const parts = note.split(/\*([^*]+)\*/);
  const plain = parts.join('');
  const ink = PACK.palette.ink;
  const paper = PACK.cards.light.fill;
  const size = Math.min(SIZE, Math.floor(760 / textWidth(plain, 1, 'display')));
  const w = Math.round(textWidth(plain, size, 'display') + PAD.x * 2);
  const h = Math.round(size * 0.95 + PAD.y * 2);
  // above the head, pushed toward its side, never off the frame
  const cx = Math.min(1080 - 50 - w / 2, Math.max(50 + w / 2, head.x + dir * 150));
  const top = Math.max(150, Math.min(head.crown - h - 40, 300));
  const tilt = -2.5 * dir;
  const seed = boilSeed(f, 17);
  // the arrow: from under the note's far end, bowing outward, to beside the head at the eye line
  const a: [number, number] = [cx + dir * (w / 2 - 70), top + h + 18];
  const b: [number, number] = [head.x + dir * (head.half + 40), head.eyes - 40];
  const c: [number, number] = [Math.min(1040, Math.max(40, b[0] + dir * 150)), (a[1] + b[1]) / 2 - 30];
  const shaft = curve(a, c, b);
  // the head of the arrow: two strokes back from the tip, along the curve's last direction
  const [px, py] = shaft[shaft.length - 2];
  const ang = Math.atan2(b[1] - py, b[0] - px);
  const barb = (k: number): [number, number] => [b[0] - 46 * Math.cos(ang + k), b[1] - 46 * Math.sin(ang + k)];
  const draw = (start: number, len: number) => (SIG.reveal === 'stepped' ? tw(Math.floor(f / 2) * 2, start, start + len) : tw(f, start, start + len));
  const pArrow = draw(from + 8, 10);
  const pHead = draw(from + 16, 4);
  const pPop = draw(from + 18, 6);
  const stroke = { fill: 'none', stroke: packColour('hero'), strokeWidth: 9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  // three short strokes radiating up and out from the other side of the head
  const o: [number, number] = [head.x - dir * head.half * 0.95, head.crown + 70];
  const pops = [110, 140, 170].map((deg): [number, number, number, number] => {
    const t = ((dir > 0 ? -deg : deg - 180) * Math.PI) / 180;
    return [o[0] + 34 * Math.cos(t), o[1] + 34 * Math.sin(t), o[0] + 84 * Math.cos(t), o[1] + 84 * Math.sin(t)];
  });
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <FullFrame shoot={shoot} at={at} k={FULL.k} crownY={FULL.crownY} />
      <svg width={1080} height={1920} style={{ position: 'absolute', inset: 0, overflow: 'visible', filter: `drop-shadow(0 3px 0 ${rgba(ink, 0.35)})` }}>
        <path d={roughPoly(shaft, false, SIG.rough * 1.4, seed)} {...stroke} pathLength={1} strokeDasharray={1} strokeDashoffset={(1 - pArrow).toFixed(3)} />
        {pHead > 0 && [barb(0.5), barb(-0.5)].map(([x, y], i) => (
          <path key={i} d={roughLine(b[0], b[1], b[0] + (x - b[0]) * pHead, b[1] + (y - b[1]) * pHead, SIG.rough, seed + i * 3)} {...stroke} />
        ))}
        {pPop > 0 && pops.map(([x0, y0, x1, y1], i) => (
          <path key={i} d={roughLine(x0, y0, x0 + (x1 - x0) * pPop, y0 + (y1 - y0) * pPop, SIG.rough, seed + 11 + i)} {...stroke} strokeWidth={7} />
        ))}
      </svg>
      <div style={{ position: 'absolute', left: cx - w / 2, top, width: w, height: h }}>
        <Rise i={0} from={from} kind="object">
          <div data-part="card" style={{ position: 'relative', width: w, height: h, background: paper, transform: `rotate(${tilt}deg)`, boxShadow: `0 16px 28px ${rgba('#000000', 0.35)}` }}>
            <svg width={w} height={h} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
              <path d={roughRect(3, 3, w - 6, h - 6, SIG.rough * 1.4, seed + 5)} fill="none" stroke={ink} strokeWidth={3.4} strokeLinecap="round" />
            </svg>
            <div style={{ position: 'absolute', left: w / 2 - 80, top: -24, width: 160, height: 46, background: rgba('#F2E6C9', 0.85), boxShadow: '0 2px 4px rgba(0,0,0,0.15)', transform: `rotate(${4 * dir}deg)` }} />
            <div style={{ position: 'absolute', left: PAD.x, top: PAD.y - size * 0.06, ...voice('display', size, { lh: 1 }), color: ink, whiteSpace: 'nowrap' }}>
              {parts.map((p, i) => (i % 2 ? <Mark key={i} kind="highlight" hero={packColour('hero')} at={from + 8} seed={31}>{p}</Mark> : <span key={i}>{p}</span>))}
            </div>
          </div>
        </Rise>
      </div>
    </AbsoluteFill>
  );
};
