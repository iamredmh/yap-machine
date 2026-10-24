import React from 'react';
import { AbsoluteFill } from 'remotion';
import { SIG } from '../engine/signature';
import { fitSize } from '../engine/text';
import { leading, MEASURE, PACK, voice } from '../engine/style';
import { cardStyle } from '../kit/card';
import { CardDecor } from '../kit/CardDecor';
import { Ground, type Theme } from '../kit/Ground';
import { Rise } from '../kit/Rise';
import { groundOf, tones } from '../kit/tones';
import { Body, Label } from '../kit/Voices';

// A quote: the words in the headline voice, one size for every line (the pack's fit rule picks it), the open and close
// marks in the hero colour, the name and role under it. On a surface other than solid it sits on a card of that
// surface (a terminal's with the command that printed it).

export type QuoteCardProps = { lines: string[]; name: string; role: string; theme?: Theme };

const PAD = 64;

export const QuoteCard: React.FC<QuoteCardProps> = ({ lines, name, role, theme }) => {
  const g = groundOf(theme);
  const t = tones(g);
  const C = PACK.composition;
  const carded = SIG.surface !== 'solid';
  const prompt = SIG.surface === 'terminal';
  const size = fitSize(lines, MEASURE - 40 - (carded ? PAD * 2 : 0), 110);
  const words = (
    <>
      {prompt && (
        <Rise i={0} style={{ marginBottom: 34 }}>
          <span style={{ ...voice('code', 28), color: t.hero }}>$ cat quote.txt</span>
        </Rise>
      )}
      {lines.map((l, i) => (
        <Rise key={l} i={i + (prompt ? 1 : 0)}>
          <div style={{ ...voice('display', size, { trackEm: -0.02, lh: 1.05 }), color: t.head, whiteSpace: 'nowrap' }}>
            {i === 0 && <span style={{ color: t.hero }}>“</span>}
            {l}
            {i === lines.length - 1 && <span style={{ color: t.hero }}>”</span>}
          </div>
        </Rise>
      ))}
      <Rise i={lines.length + (prompt ? 1 : 0)} style={{ marginTop: C.gap.object }}>
        <Body size={38} colour={t.head}>{name}</Body>
      </Rise>
      <Rise i={lines.length + (prompt ? 2 : 1)} style={{ marginTop: 14 }}>
        <Label size={24} colour={t.soft}>{role}</Label>
      </Rise>
    </>
  );
  if (!carded) {
    return (
      <AbsoluteFill>
        <Ground theme={g} />
        <div style={{ position: 'absolute', left: C.margin, right: C.margin, top: C.top + 120, textAlign: C.align }}>{words}</div>
      </AbsoluteFill>
    );
  }
  // the card's height, from the type it holds: lines at the quote's pitch, the gap, the name and the role. A quote
  // shows its own words (no captions under it), so the card takes the middle of the frame, a little high
  const pitch = size * leading(1.05, 'display');
  const h = Math.round(PAD * 2 + (prompt ? 60 : 0) + lines.length * pitch + C.gap.object + 46 + 14 + 30);
  return (
    <AbsoluteFill>
      <Ground theme={g} />
      <div style={{ position: 'absolute', left: C.margin, right: C.margin, top: Math.max(C.top + 100, Math.round(880 - h / 2)), display: 'flex', justifyContent: C.align === 'center' ? 'center' : 'flex-start' }}>
        <Rise i={0} kind="object">
          <div data-part="card" style={{ position: 'relative', width: MEASURE, height: h, ...cardStyle(MEASURE, h, g) }}>
            <CardDecor w={MEASURE} h={h} theme={g} seed={23} />
            <div style={{ position: 'absolute', left: PAD, right: PAD, top: PAD, textAlign: C.align }}>{words}</div>
          </div>
        </Rise>
      </div>
    </AbsoluteFill>
  );
};
