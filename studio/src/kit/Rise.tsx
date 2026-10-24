import React from 'react';
import { useCurrentFrame } from 'remotion';
import { REVEAL, reveal, tw } from '../engine/motion';
import { SIG } from '../engine/signature';
import { PACK } from '../engine/style';
import { rng } from './rough';

/**
 * A line arriving on the pack's reveal, `i` lines into its stack. The signature picks how: rising the pack's distance
 * (the default), in steps like drawn animation (twelve drawings a second, each a hair off the last), typed in from the
 * left in character-sized steps (an object wipes down instead), or rising out of a blur.
 */
export const Rise: React.FC<{ i: number; from?: number; children: React.ReactNode; style?: React.CSSProperties; kind?: 'text' | 'object' }> = ({ i, from = 0, children, style, kind = 'text' }) => {
  const f = useCurrentFrame();
  const at = from + i * REVEAL.stagger;

  if (SIG.reveal === 'stepped') {
    const fq = Math.floor(f / 2) * 2;
    const p = tw(fq, at, at + REVEAL.dur, reveal);
    const r = rng(fq * 31 + i * 7 + 1);
    const j = p < 1 ? 2.2 : 0;
    const dx = (r() * 2 - 1) * j;
    const dy = (r() * 2 - 1) * j;
    return <div style={{ transform: `translate(${dx.toFixed(1)}px, ${((1 - p) * PACK.motion.rise + dy).toFixed(1)}px) rotate(${((r() * 2 - 1) * j * 0.25).toFixed(2)}deg)`, opacity: p > 0.05 ? 1 : 0, ...style }}>{children}</div>;
  }

  if (SIG.reveal === 'type') {
    const steps = kind === 'text' ? 18 : 8;
    const raw = tw(f, at, at + REVEAL.dur * 1.6);
    const p = Math.ceil(raw * steps) / steps;
    const clip = kind === 'text' ? `inset(-30% ${((1 - p) * 100).toFixed(1)}% -30% -2%)` : `inset(-4% -4% ${((1 - p) * 100).toFixed(1)}% -4%)`;
    return <div style={{ clipPath: p >= 1 ? undefined : clip, opacity: raw > 0 ? 1 : 0, ...style }}>{children}</div>;
  }

  const p = tw(f, at, at + REVEAL.dur, reveal);
  if (SIG.reveal === 'blur') {
    return <div style={{ transform: `translateY(${((1 - p) * PACK.motion.rise * 0.6).toFixed(1)}px) scale(${(0.97 + 0.03 * p).toFixed(4)})`, filter: p < 1 ? `blur(${((1 - p) * 18).toFixed(1)}px)` : undefined, opacity: Math.min(1, p * 1.4), ...style }}>{children}</div>;
  }
  return <div style={{ transform: `translateY(${((1 - p) * PACK.motion.rise).toFixed(1)}px)`, opacity: Math.min(1, p * 1.6), ...style }}>{children}</div>;
};
