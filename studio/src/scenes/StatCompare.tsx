import React from 'react';
import { AbsoluteFill } from 'remotion';
import { breakLines } from '../engine/text';
import { FONT, leading, MEASURE, PACK } from '../engine/style';
import { SIG } from '../engine/signature';
import { cardStyle } from '../kit/card';
import { CardDecor } from '../kit/CardDecor';
import { IconBadge } from '../kit/IconBadge';
import { Mark, markInk } from '../kit/Mark';
import { Fit } from '../kit/Fit';
import { Ground, type Theme } from '../kit/Ground';
import { Rise } from '../kit/Rise';
import { Sub, SubKey } from '../kit/Subtitle';
import { groundOf, tones } from '../kit/tones';
import { Heavy, Label, Lead } from '../kit/Voices';

// Before and after: a lead-in and a headline, a short paragraph the engine breaks to the pack's measure, then a card
// with the old number struck through and the new one in the hero colour.

export type StatCompareProps = {
  lead: string;
  title: string;
  text: string;
  before: { k: string; v: string };
  after: { k: string; v: string };
  sub?: { text: string; key: string };
  /** An icon by its name (src/kit/Icon.tsx), in the card's corner when the pack draws icons. */
  icon?: string;
  theme?: Theme;
};

export const StatCompare: React.FC<StatCompareProps> = ({ lead, title, text, before, after, sub, icon, theme }) => {
  const g = groundOf(theme);
  const t = tones(g);
  const C = PACK.composition;
  const lines = breakLines(text, 36, MEASURE);
  const cardH = 470;
  return (
    <AbsoluteFill>
      <Ground theme={g} />
      <div style={{ position: 'absolute', left: C.margin, right: C.margin, top: C.top, textAlign: C.align }}>
        <Rise i={0}><Lead size={64} colour={t.soft}>{lead}</Lead></Rise>
        <Rise i={1} style={{ marginTop: C.gap.tagline }}>
          <Fit><Heavy size={170} colour={t.head}>{title}</Heavy></Fit>
        </Rise>
        <Rise i={2} style={{ marginTop: C.gap.tagline, font: `${PACK.type.body.weight} 36px/${leading(1.45, 'body')} ${FONT.body}`, color: t.soft }}>
          {lines.map((l) => <div key={l}>{l}</div>)}
        </Rise>
        <Rise i={3} kind="object" style={{ marginTop: C.gap.object, display: 'flex', justifyContent: C.align === 'center' ? 'center' : 'flex-start' }}>
          <div data-part="card" style={{ width: MEASURE, height: cardH, position: 'relative', textAlign: 'left', ...cardStyle(MEASURE, cardH, g) }}>
            <CardDecor w={MEASURE} h={cardH} theme={g} seed={5} />
            {icon && SIG.icons !== 'none' && (
              <div style={{ position: 'absolute', right: 48, top: 48 }}>
                <IconBadge name={icon} theme={g} size={150} />
              </div>
            )}
            <div style={{ position: 'absolute', left: 56, top: 52 }}><Label size={26} colour={t.soft}>{before.k}</Label></div>
            <div style={{ position: 'absolute', left: 56, top: 100 }}>
              <Heavy size={130} colour={t.soft} style={{ textDecoration: 'line-through', textDecorationThickness: 6 }}>{before.v}</Heavy>
            </div>
            <div style={{ position: 'absolute', left: 56, top: 262 }}><Label size={26} colour={t.soft}>{after.k}</Label></div>
            <div style={{ position: 'absolute', left: 56, top: 310 }}>
              {SIG.mark !== 'none' ? (
                <Heavy size={130} colour={markInk(SIG.mark, t.hero, t.head, PACK.cards[g].fill)}>
                  <Mark hero={t.hero} at={22} seed={41}>{after.v}</Mark>
                </Heavy>
              ) : (
                <Heavy size={130} colour={t.hero}>{after.v}</Heavy>
              )}
            </div>
          </div>
        </Rise>
      </div>
      {sub && (
        <Sub light={!t.dark}>
          {sub.text} <SubKey>{sub.key}</SubKey>
        </Sub>
      )}
    </AbsoluteFill>
  );
};
