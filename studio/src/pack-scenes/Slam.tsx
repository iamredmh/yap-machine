import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { rgba } from '../engine/colour';
import { expoOut, ring, spring01, tw } from '../engine/motion';
import { SIG } from '../engine/signature';
import { MEASURE, packColour, PACK, requireScene } from '../engine/style';
import { textWidth } from '../engine/text';
import { Ground, type Theme } from '../kit/Ground';
import { Mark, markInk } from '../kit/Mark';
import { Rise } from '../kit/Rise';
import { groundOf, tones } from '../kit/tones';
import { Heavy, Label } from '../kit/Voices';

// The slam: a scene type a pack brings (Volt). One number or word that hits, as big as the frame's width allows: the
// old value waits above, gets struck out, and the new one slams down on the spoken word, arriving huge and settling on
// the pack's spring, with a shake, a shockwave in the hero colour and, if the pack flashes, a flash. Graphic only.

export type SlamProps = { value: string; was?: string; label?: string; at?: number; theme?: Theme };

/** The largest the value sets (a reference size): a cap height of 574 px, under a third of the frame. */
const MOST = 820;

export const Slam: React.FC<SlamProps> = ({ value, was, label, at = 10, theme }) => {
  requireScene('slam');
  const f = useCurrentFrame();
  const g = groundOf(theme);
  const t = tones(g);
  const C = PACK.composition;
  // the value fills the measure (from the letter metrics, so it holds on every frame), up to MOST
  const size = Math.min(MOST, Math.floor((MEASURE * 0.94) / textWidth(value, 1, 'display', -0.02)));
  const wasSize = was ? Math.min(170, Math.floor((MEASURE * 0.6) / textWidth(was, 1, 'display', -0.02))) : 0;
  const s = spring01(f - at);
  const landed = f >= at;
  const shake = ring(f - at, 0.42, 6) * 26;
  const shock = tw(f, at, at + 16, expoOut);
  const strike = tw(f, at - 9, at - 2, expoOut);
  const fl = PACK.transitions.flash;
  // the stack's height, to centre it above the caption lane: the old value, the new one, the label, and the gaps
  const capH = (x: number) => x * 0.7;
  const h = (was ? capH(wasSize) + 60 : 0) + capH(size) + (label ? 70 + 30 : 0);
  // centred a little above the frame's middle, clear of the caption lane under it
  const top = Math.round(Math.min(820, PACK.subtitles.laneY - 160 - h / 2) - h / 2);
  /** The value's centre, where the light and the shockwave start. */
  const cy = top + (was ? capH(wasSize) + 60 : 0) + capH(size) / 2;
  const justify = C.align === 'center' ? 'center' : 'flex-start';
  const marked = SIG.mark !== 'none';
  return (
    <AbsoluteFill>
      <Ground theme={g} />
      {/* the light the value lands in: a pulse of the hero colour behind it, and the shockwave spreading out */}
      {landed && (
        <>
          <AbsoluteFill style={{ background: `radial-gradient(ellipse 70% 32% at 50% ${(cy / 19.2).toFixed(1)}%, ${rgba(t.hero, 0.34 * (1 - shock * 0.7))}, transparent 70%)`, mixBlendMode: t.dark ? 'screen' : 'multiply' }} />
          <div style={{ position: 'absolute', left: 540 - 900 * shock, top: cy - 900 * shock, width: 1800 * shock, height: 1800 * shock, borderRadius: '50%', boxShadow: `inset 0 0 0 ${(14 * (1 - shock)).toFixed(1)}px ${rgba(t.hero, 0.8 * (1 - shock))}` }} />
        </>
      )}
      <div style={{ position: 'absolute', left: C.margin, right: C.margin, top, transform: `translate(${shake.toFixed(1)}px, ${(shake * 0.5).toFixed(1)}px)` }}>
        {was && (
          <Rise i={0} style={{ display: 'flex', justifyContent: justify, marginBottom: 60 }}>
            <span style={{ position: 'relative', display: 'inline-block', opacity: landed ? 0.55 : 1 }}>
              <Heavy size={wasSize} colour={t.soft}>{was}</Heavy>
              {/* struck out just before the new value lands, in the friction colour */}
              <span style={{ position: 'absolute', left: '-4%', top: '42%', width: `${(108 * strike).toFixed(1)}%`, height: Math.max(8, wasSize * 0.07), background: packColour('friction'), transform: 'rotate(-4deg)', transformOrigin: '0 50%' }} />
            </span>
          </Rise>
        )}
        <div style={{ display: 'flex', justifyContent: justify, height: capH(size), alignItems: 'flex-end' }}>
          {landed && (
            <span style={{ display: 'inline-block', transform: `scale(${(1 + 0.85 * (1 - s)).toFixed(3)})`, transformOrigin: '50% 75%', filter: f - at < 2 ? 'blur(6px)' : undefined, lineHeight: 0.7 }}>
              {marked ? (
                <Heavy size={size} colour={markInk(SIG.mark, t.hero, t.head, PACK.grounds[g].colour)}>
                  <Mark hero={t.hero} at={at} seed={71}>{value}</Mark>
                </Heavy>
              ) : (
                <Heavy size={size} colour={t.hero} style={{ display: 'inline-block', lineHeight: 0.7, textShadow: `0 0 ${(80 * (1 - shock) + 30).toFixed(0)}px ${rgba(t.hero, 0.45)}` }}>{value}</Heavy>
              )}
            </span>
          )}
        </div>
        {label && (
          <Rise i={0} from={at + 4} style={{ display: 'flex', justifyContent: justify, marginTop: 70 }}>
            <Label size={54} colour={t.head}>{label}</Label>
          </Rise>
        )}
      </div>
      {fl.enabled && f >= at && f < at + fl.frames && <AbsoluteFill style={{ background: packColour(fl.colour), opacity: 0.55 }} />}
    </AbsoluteFill>
  );
};
