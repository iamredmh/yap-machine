import React from 'react';
import { voice } from '../engine/style';

// The voices as components. Sizes are reference sizes (src/engine/reference.ts): a Heavy of 200 has a cap height of
// 140 in every pack.

type P = { size: number; colour: string; children: React.ReactNode; style?: React.CSSProperties };

/** The headline voice. */
export const Heavy: React.FC<P & { caps?: boolean }> = ({ size, colour, caps = false, children, style }) => (
  <span style={{ ...voice('display', size, { trackEm: -0.02, lh: 0.9, caseAsked: caps ? 'uppercase' : 'none' }), color: colour, ...style }}>{children}</span>
);

/** The lead-in that steps aside. */
export const Lead: React.FC<P> = ({ size, colour, children, style }) => (
  <span style={{ ...voice('accent', size, { lh: 1.1 }), color: colour, ...style }}>{children}</span>
);

/** Eyebrows, counters, small lines. */
export const Label: React.FC<P> = ({ size, colour, children, style }) => (
  <span style={{ ...voice('label', size, { trackEm: 0.08, caseAsked: 'uppercase' }), color: colour, ...style }}>{children}</span>
);

/** Running text. */
export const Body: React.FC<P> = ({ size, colour, children, style }) => (
  <span style={{ ...voice('body', size, { lh: 1.4 }), color: colour, ...style }}>{children}</span>
);
