import React from 'react';
import { mixHex } from '../engine/colour';
import { SIG } from '../engine/signature';
import { HERO, P, PACK } from '../engine/style';
import { cardStyle } from './card';
import type { Theme } from './Ground';
import { Icon } from './Icon';

// An icon on the surface the signature uses: frosted on glass, an ink-bordered square on brutal, a bordered panel on a
// terminal, and straight on the page for sketch and solid (where a drawing sits on paper and needs no badge).

export const IconBadge: React.FC<{ name: string; theme: Theme; size?: number }> = ({ name, theme, size = 140 }) => {
  const dark = theme === 'dark';
  const head = dark ? P.text : P.ink;
  const surface = SIG.surface;
  const bare = surface === 'sketch' || surface === 'solid';
  const iconSize = bare ? size : Math.round(size * 0.56);
  const card = PACK.cards[theme];
  // what the icon's details are cut out in, and what it's drawn in
  const behind = bare ? PACK.grounds[theme].colour : surface === 'brutal' ? HERO : card.fill;
  const colour = surface === 'brutal' ? P.ink : surface === 'terminal' ? HERO : head;
  const icon = <Icon name={name} size={iconSize} colour={colour} hero={surface === 'brutal' ? mixHex(HERO, '#FFFFFF', 0.4) : HERO} knock={behind} />;
  if (bare) return <div data-part="icon" style={{ width: size, height: size }}>{icon}</div>;
  const base = cardStyle(size, size, theme);
  const badge: React.CSSProperties = {
    ...base,
    width: size,
    height: size,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: surface === 'glass' ? size / 2 : surface === 'terminal' ? 0 : Math.min(card.radius, size * 0.22),
    ...(surface === 'brutal' ? { background: HERO, transform: `rotate(${-SIG.tilt * 1.5}deg)` } : {}),
  };
  return <div data-part="icon" style={badge}>{icon}</div>;
};
