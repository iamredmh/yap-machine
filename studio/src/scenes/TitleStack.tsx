import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { spring01 } from '../engine/motion';
import { PACK } from '../engine/style';
import { SIG } from '../engine/signature';
import { Fit } from '../kit/Fit';
import { Mark, markInk } from '../kit/Mark';
import { Ground, type Theme } from '../kit/Ground';
import { BAND, HalfBand, type Shoot } from '../kit/Presenter';
import { Rise } from '../kit/Rise';
import { Sub, SubKey } from '../kit/Subtitle';
import { groundOf, tones } from '../kit/tones';
import { Heavy, Lead } from '../kit/Voices';

// The title scene: a lead-in, two or three headline lines (one word in the hero colour, landing on the pack's spring),
// the presenter in the half band below, the subtitle line. Where the stack sits and how it lines up is the pack's.

export type TitleWord = { t: string; hero?: boolean };
export type TitleStackProps = {
  lead: string;
  lines: TitleWord[][];
  /** Reference sizes per line. */
  sizes: number[];
  sub?: { text: string; key: string };
  shoot?: Shoot;
  at?: number;
  theme?: Theme;
};

export const TitleStack: React.FC<TitleStackProps> = ({ lead, lines, sizes, sub, shoot, at = 0, theme }) => {
  const f = useCurrentFrame();
  const g = groundOf(theme);
  const t = tones(g);
  const C = PACK.composition;
  const land = spring01(f - 8);
  return (
    <AbsoluteFill>
      <Ground theme={g} />
      <div style={{ position: 'absolute', left: C.margin, right: C.margin, top: C.top, textAlign: C.align }}>
        <Rise i={0}>
          <Lead size={64} colour={t.soft}>{lead}</Lead>
        </Rise>
        {lines.map((line, i) => (
          <Rise key={i} i={i + 1} style={{ marginTop: i === 0 ? C.gap.eyebrow : C.gap.tagline }}>
            <Fit>
              {line.map((w, j) => (
                w.hero && SIG.mark !== 'none' ? (
                  // the signature's mark on the hero word, drawn on as it lands
                  <Heavy key={j} size={sizes[i]} colour={markInk(SIG.mark, t.hero, t.head, PACK.grounds[g].colour)} style={{ display: 'inline-block', marginLeft: j > 0 ? '0.24em' : 0 }}>
                    <Mark hero={t.hero} at={10 + i * 4} seed={i * 13 + j}>{w.t}</Mark>
                  </Heavy>
                ) : (
                  <Heavy
                    key={j}
                    size={sizes[i]}
                    colour={w.hero ? t.hero : t.head}
                    // the gap between words is the face's own space, set inside the voice (a space outside it takes the page's font)
                    style={{ display: 'inline-block', marginLeft: j > 0 ? '0.24em' : 0, ...(w.hero ? { transform: `scale(${(0.7 + 0.3 * land).toFixed(3)})`, transformOrigin: '50% 70%' } : {}) }}
                  >
                    {w.t}
                  </Heavy>
                )
              ))}
            </Fit>
          </Rise>
        ))}
      </div>
      {/* the camera as shot, filling the frame below the stack, eyes on its upper third */}
      {shoot && <HalfBand shoot={shoot} at={at} top={BAND.top} />}
      {sub && (
        // over the band, the caption rides its top edge, clear of the face
        <Sub light={shoot ? PACK.composition.ground === 'light' : !t.dark} y={shoot ? BAND.top : undefined} seam={!!shoot}>
          {sub.text} <SubKey>{sub.key}</SubKey>
        </Sub>
      )}
    </AbsoluteFill>
  );
};
