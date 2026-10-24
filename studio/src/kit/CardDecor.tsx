import React from 'react';
import { useCurrentFrame } from 'remotion';
import { rgba } from '../engine/colour';
import { boilSeed, SIG } from '../engine/signature';
import { HERO, P } from '../engine/style';
import type { Theme } from './Ground';
import { roughLine, roughRect } from './rough';

// What a card's surface draws on top of its CSS (src/kit/card.ts): on a sketch surface, the hand-drawn border (gone
// over twice, boiling) and a strip of tape, and a hand-drawn rule under each row; on a terminal surface, the panel's
// corner marks and its three status squares. Other surfaces draw nothing here.

export const CardDecor: React.FC<{ w: number; h: number; theme: Theme; level?: 0 | 1; seed?: number }> = ({ w, h, theme, level = 0, seed = 3 }) => {
  const f = useCurrentFrame();
  const ink = theme === 'dark' ? P.text : P.ink;
  const svg: React.CSSProperties = { position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' };

  if (SIG.surface === 'sketch') {
    const s = boilSeed(f, seed);
    if (level > 0) {
      return (
        <svg width={w} height={h} style={svg}>
          <path d={roughLine(8, h - 1, w - 8, h - 3, SIG.rough * 0.8, s)} fill="none" stroke={rgba(ink, 0.45)} strokeWidth={2.2} strokeLinecap="round" />
        </svg>
      );
    }
    return (
      <>
        <svg width={w} height={h} style={svg}>
          <path d={roughRect(2, 2, w - 4, h - 4, SIG.rough * 1.6, s)} fill="none" stroke={ink} strokeWidth={3.4} strokeLinecap="round" />
        </svg>
        {/* a strip of tape holding the card to the page */}
        <div style={{ position: 'absolute', left: w / 2 - 90, top: -22, width: 180, height: 44, background: rgba('#F2E6C9', 0.78), boxShadow: '0 2px 4px rgba(0,0,0,0.08)', transform: 'rotate(-3deg)' }} />
      </>
    );
  }

  if (SIG.surface === 'terminal' && level === 0) {
    const c = rgba(HERO, 0.9);
    const L = 26;
    const corner = (x: number, y: number, sx: number, sy: number) => `M${x} ${y + sy * L} L${x} ${y} L${x + sx * L} ${y}`;
    return (
      <svg width={w} height={h} style={svg}>
        <g fill="none" stroke={c} strokeWidth={4}>
          <path d={corner(-6, -6, 1, 1)} />
          <path d={corner(w + 6, -6, -1, 1)} />
          <path d={corner(-6, h + 6, 1, -1)} />
          <path d={corner(w + 6, h + 6, -1, -1)} />
        </g>
        {[0, 1, 2].map((i) => <rect key={i} x={w - 34 - i * 22} y={12} width={12} height={12} fill={i === 0 ? c : rgba(HERO, 0.35)} />)}
      </svg>
    );
  }
  return null;
};
