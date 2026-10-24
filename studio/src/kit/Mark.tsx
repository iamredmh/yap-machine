import React from 'react';
import { useCurrentFrame } from 'remotion';
import { onColour, rgba } from '../engine/colour';
import { tw, expoOut } from '../engine/motion';
import { PACK } from '../engine/style';
import { boilSeed, SIG } from '../engine/signature';
import { roughEllipse, roughLine, rng } from './rough';

// The signature's mark: how the hero word or the winning number is picked out. It wraps the words and draws around
// them in the hero colour, drawn on from `at`; hand-drawn kinds wobble as the signature says. The words' own colour
// for each kind comes from markInk(), so the scene sets it and the mark never fights it.

export type MarkKind = 'none' | 'highlight' | 'underline' | 'circle' | 'box' | 'invert' | 'glow';

/** The colour the marked words take for a kind: on a filled mark the colour that reads on the hero colour, else the hero colour or the head colour. */
export const markInk = (kind: MarkKind, hero: string, head: string, ground: string) => {
  if (kind === 'highlight' || kind === 'box') return onColour(hero, PACK.palette.ink, '#FFFFFF');
  if (kind === 'invert') return ground;
  if (kind === 'underline' || kind === 'circle') return head;
  return hero;
};

const DRAW = 12;

export const Mark: React.FC<{ kind?: MarkKind; hero: string; at?: number; seed?: number; children: React.ReactNode; style?: React.CSSProperties }> = ({
  kind = SIG.mark, hero, at = 0, seed = 11, children, style,
}) => {
  const f = useCurrentFrame();
  const p = tw(f, at, at + DRAW, expoOut);
  const rough = Math.max(SIG.rough, kind === 'box' || kind === 'invert' || kind === 'glow' ? 0 : 1.5);
  const s = boilSeed(f, seed);
  // its own stacking context, so a mark drawn behind the words stays behind them, not behind the ground
  const wrap: React.CSSProperties = { position: 'relative', display: 'inline-block', isolation: 'isolate', ...style };
  const part = { 'data-part': 'mark' } as const;
  if (kind === 'none') return <span {...part} style={wrap}>{children}</span>;

  if (kind === 'glow') {
    return <span {...part} style={{ ...wrap, textShadow: `0 0 ${(40 * p).toFixed(0)}px ${rgba(hero, 0.75)}, 0 0 ${(90 * p).toFixed(0)}px ${rgba(hero, 0.45)}` }}>{children}</span>;
  }

  if (kind === 'box' || kind === 'invert') {
    const brutal = SIG.surface === 'brutal';
    const ink = PACK.palette.ink;
    return (
      <span {...part} style={{ ...wrap, padding: kind === 'invert' ? '0 0.12em' : '0.02em 0.16em', margin: '0 0.04em' }}>
        <span
          style={{
            position: 'absolute', inset: 0, zIndex: -1, background: hero,
            borderRadius: kind === 'invert' || brutal ? Math.min(10, PACK.cards.light.radius / 2) : 12,
            border: brutal ? `5px solid ${ink}` : undefined,
            boxShadow: brutal ? `8px 8px 0 ${ink}` : undefined,
            transform: `scaleX(${p.toFixed(3)}) rotate(${brutal ? SIG.tilt * 0.8 : 0}deg)`,
            transformOrigin: '0 50%',
          }}
        />
        {children}
      </span>
    );
  }

  // drawn marks: an SVG over the words, in a box a little bigger than them, in % of the words' box
  const r = rng(s);
  const j = (n: number) => (r() * 2 - 1) * n;
  let body: React.ReactNode = null;
  if (kind === 'highlight') {
    // a marker stroke behind the lower two thirds of the words, its ends ragged
    const y0 = 30 + j(3);
    const y1 = 96 + j(3);
    const x1 = -4 + 108 * p;
    const pts = `-4,${y0 + j(2)} ${x1},${y0 + j(3)} ${x1 + j(2)},${y1 + j(2)} -4,${y1 + j(3)}`;
    body = <polygon points={pts} fill={rgba(hero, 0.92)} />;
    return (
      <span {...part} style={wrap}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', overflow: 'visible', zIndex: -1 }}>
          {body}
        </svg>
        {children}
      </span>
    );
  }
  const stroke = { fill: 'none', stroke: hero, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, vectorEffect: 'non-scaling-stroke' as const, pathLength: 1, strokeDasharray: 1, strokeDashoffset: (1 - p).toFixed(3) };
  if (kind === 'underline') body = <path d={roughLine(-2, 104, 102, 100 + j(3), rough * 0.6, s)} strokeWidth={9} {...stroke} />;
  if (kind === 'circle') body = <path d={roughEllipse(50, 52, 62, 74, rough * 0.8, s)} strokeWidth={7} {...stroke} />;
  return (
    <span {...part} style={wrap}>
      {children}
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}>
        {body}
      </svg>
    </span>
  );
};

/** A block cursor after the words, blinking every half second. */
export const Cursor: React.FC<{ colour: string }> = ({ colour }) => {
  const f = useCurrentFrame();
  return <span style={{ display: 'inline-block', width: '0.42em', height: '0.78em', marginLeft: '0.12em', background: colour, opacity: Math.floor(f / 15) % 2 ? 0 : 1, verticalAlign: '-0.06em' }} />;
};
