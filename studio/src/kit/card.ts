import type React from 'react';
import { rgba } from '../engine/colour';
import type { CardSpec } from '../engine/pack';
import { SIG } from '../engine/signature';
import { HERO, P, PACK } from '../engine/style';
import type { Theme } from './Ground';

// Cards from the pack's `cards`, made of the signature's surface. Solid (the default): a fill (a lit gradient or flat),
// an optional light catch along the top edge, the shadow scaled with the card's size, and an optional ring. Glass:
// frosted, with a bright edge. Brutal: an ink border and a hard shadow. Sketch: paper, its border drawn by hand
// (CardDecor). Terminal: a flat panel with a fine border. Level 1 and 2 are the steps inside a card.

const REF = Math.sqrt(740 * 112);

const shadowCss = (c: CardSpec, w: number, h: number) => {
  const k = Math.min(2.2, Math.max(0.3, Math.sqrt(Math.sqrt(Math.max(1, w * h)) / REF)));
  const s = c.shadow;
  return `${(s.dx * k).toFixed(1)}px ${(s.dy * k).toFixed(1)}px ${(s.blur * k).toFixed(1)}px ${rgba(s.colour, s.alpha)}`;
};

/** The signature's lean, on a card (level 0) only. */
const lean = (): React.CSSProperties => (SIG.tilt ? { transform: `rotate(${SIG.tilt}deg)` } : {});

export const cardStyle = (w: number, h: number, theme: Theme = 'dark', level: 0 | 1 | 2 = 0): React.CSSProperties => {
  const c = PACK.cards[theme];
  const text = theme === 'dark' ? P.text : P.ink;
  const light = theme === 'light';
  const inner = Math.max(6, c.radius * 0.6);

  if (SIG.surface === 'glass') {
    if (level > 0) return { background: light ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.07)', borderRadius: inner, boxShadow: `inset 0 0 0 1px ${light ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.09)'}` };
    const blur = 'blur(30px) saturate(1.6)';
    return {
      background: light ? 'linear-gradient(180deg, rgba(255,255,255,0.78), rgba(255,255,255,0.5))' : 'linear-gradient(180deg, rgba(255,255,255,0.15), rgba(255,255,255,0.05))',
      backdropFilter: blur,
      WebkitBackdropFilter: blur,
      borderRadius: c.radius,
      boxShadow: [
        `inset 0 0 0 1.5px ${light ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.2)'}`,
        `inset 0 2px 0 ${light ? 'rgba(255,255,255,1)' : 'rgba(255,255,255,0.28)'}`,
        `0 40px 80px ${rgba('#000000', light ? 0.12 : 0.42)}`,
      ].join(', '),
      ...lean(),
    };
  }

  if (SIG.surface === 'brutal') {
    const ink = P.ink;
    if (level > 0) return { background: level === 1 ? c.up : c.up2, borderRadius: Math.max(4, c.radius * 0.5), boxShadow: `inset 0 0 0 3px ${ink}` };
    return { background: c.fill, borderRadius: c.radius, boxShadow: `inset 0 0 0 5px ${ink}, 14px 14px 0 ${ink}`, ...lean() };
  }

  if (SIG.surface === 'sketch') {
    if (level > 0) return { background: 'transparent', borderRadius: 0 };
    return { background: c.fill, borderRadius: 3, boxShadow: `0 14px 26px ${rgba('#000000', light ? 0.09 : 0.35)}`, ...lean() };
  }

  if (SIG.surface === 'terminal') {
    if (level > 0) return { background: level === 1 ? c.up : c.up2, borderRadius: 0 };
    return { background: c.fill, borderRadius: 0, boxShadow: `inset 0 0 0 2px ${c.ring?.colour ?? P.line}, 0 0 60px ${rgba(HERO, 0.1)}`, ...lean() };
  }

  if (level > 0) return { background: level === 1 ? c.up : c.up2, borderRadius: Math.max(6, c.radius * 0.6) };
  const fill = `linear-gradient(180deg, ${c.top} 0%, ${c.fill} 45%, ${c.bottom} 100%)`;
  const catchLine = c.lightCatch > 0 ? `linear-gradient(90deg, ${rgba(text, c.lightCatch)} 0%, ${rgba(text, c.lightCatch / 2)} 45%, ${rgba(text, 0)} 100%) top / 100% 1px no-repeat, ` : '';
  return {
    background: catchLine + fill,
    borderRadius: c.radius,
    boxShadow: [c.ring ? `0 0 0 ${c.ring.width}px ${c.ring.colour}` : '', shadowCss(c, w, h)].filter(Boolean).join(', '),
  };
};
