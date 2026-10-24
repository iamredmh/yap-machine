import React from 'react';
import { AbsoluteFill } from 'remotion';
import { onColour } from '../engine/colour';
import { MEASURE, PACK } from '../engine/style';
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
import { Body, Heavy, Label } from '../kit/Voices';

// A list item: where it is in the list, its name, a line on what it does, and a card of facts with the one that matters
// in the hero colour. Graphic only: the presenter comes back on the next scene.

export type ListItemProps = {
  index: number;
  of: number;
  kind: string;
  name: string;
  line: string;
  facts: { k: string; v: string; win?: boolean }[];
  sub?: { text: string; key: string };
  /** An icon by its name (src/kit/Icon.tsx), shown when the pack draws icons. */
  icon?: string;
  theme?: Theme;
};

export const ListItem: React.FC<ListItemProps> = ({ index, of, kind, name, line, facts, sub, icon, theme }) => {
  const g = groundOf(theme);
  const t = tones(g);
  const C = PACK.composition;
  const rowH = 118;
  const pad = 36;
  const cardH = pad * 2 + facts.length * rowH + (facts.length - 1) * 16;
  return (
    <AbsoluteFill>
      <Ground theme={g} />
      <div style={{ position: 'absolute', left: C.margin, right: C.margin, top: C.top, textAlign: C.align }}>
        {icon && SIG.icons !== 'none' && (
          <Rise i={0} kind="object" style={{ marginBottom: 34, display: 'flex', justifyContent: C.align === 'center' ? 'center' : 'flex-start' }}>
            <IconBadge name={icon} theme={g} />
          </Rise>
        )}
        <Rise i={0}>
          <Label size={30} colour={t.label}>{`${kind} ${String(index).padStart(2, '0')} / ${String(of).padStart(2, '0')}`}</Label>
        </Rise>
        <Rise i={1} style={{ marginTop: C.gap.eyebrow }}>
          <Fit><Heavy size={190} colour={t.head}>{name}</Heavy></Fit>
        </Rise>
        <Rise i={2} style={{ marginTop: C.gap.tagline }}>
          <Body size={40} colour={t.soft}>{line}</Body>
        </Rise>
        <Rise i={3} kind="object" style={{ marginTop: C.gap.object, display: 'flex', justifyContent: C.align === 'center' ? 'center' : 'flex-start' }}>
          <div data-part="card" style={{ width: MEASURE, height: cardH, position: 'relative', ...cardStyle(MEASURE, cardH, g) }}>
            <CardDecor w={MEASURE} h={cardH} theme={g} />
            {facts.map((x, i) => (
              <div
                key={x.k}
                style={{
                  position: 'absolute', left: pad, right: pad, top: pad + i * (rowH + 16), height: rowH, padding: '0 34px',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', ...cardStyle(MEASURE - 2 * pad, rowH, g, 1),
                }}
              >
                <CardDecor w={MEASURE - 2 * pad} h={rowH} theme={g} level={1} seed={i + 7} />
                <Label size={26} colour={t.soft}>{x.k}</Label>
                {x.win && SIG.mark !== 'none' ? (
                  <Heavy size={64} colour={markInk(SIG.mark, t.hero, t.head, PACK.cards[g].fill)}>
                    <Mark hero={t.hero} at={20} seed={i * 5 + 3}>{x.v}</Mark>
                  </Heavy>
                ) : (
                  <span style={x.win ? { background: t.hero, padding: '4px 16px', borderRadius: PACK.cards[g].radius / 2 } : undefined}>
                    <Heavy size={64} colour={x.win ? onColour(t.hero, PACK.palette.ink, '#FFFFFF') : t.head}>{x.v}</Heavy>
                  </span>
                )}
              </div>
            ))}
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
