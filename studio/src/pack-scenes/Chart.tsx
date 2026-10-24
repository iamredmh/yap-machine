import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { mixHex } from '../engine/colour';
import { glide, REVEAL, tw } from '../engine/motion';
import { MEASURE, PACK, requireScene } from '../engine/style';
import { Fit } from '../kit/Fit';
import { Ground, type Theme } from '../kit/Ground';
import { Rise } from '../kit/Rise';
import { groundOf, tones } from '../kit/tones';
import { Heavy, Label, Lead } from '../kit/Voices';

// The chart: a scene type a pack brings (Ledger). An editorial chart, set on the page rather than in a card: a lead-in
// and a headline, a hairline rule drawn across the measure, then two to five bars drawn in from a hairline axis, one
// after another, each value counting up at its bar's end as the bar grows. The bar that matters is the hero colour and
// the rest a quiet tint of the type; a bar at zero is a tick on the axis. A source line closes it. Graphic only.

export type ChartBar = { k: string; v: number; label: string; win?: boolean };
export type ChartProps = { lead: string; title: string; bars: ChartBar[]; source?: string; theme?: Theme };

/** The room the bars share, px: thicker bars and more air for fewer of them. */
const ROOM = 840;
/** A bar's name sits this far above it. */
const NAME = 54;

/** A shown value counting up with its bar: the number inside the label ("$240", "1.5k") at `p` of itself. */
const counting = (label: string, p: number) => {
  const m = label.match(/^(\D*?)(\d[\d,]*(?:\.\d+)?)(.*)$/);
  if (!m || p >= 1) return label;
  const [, pre, digits, post] = m;
  const n = Number(digits.replace(/,/g, '')) * p;
  const dp = digits.includes('.') ? digits.split('.')[1].length : 0;
  const s = n.toFixed(dp);
  return `${pre}${digits.includes(',') ? Number(s).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }) : s}${post}`;
};

export const Chart: React.FC<ChartProps> = ({ lead, title, bars, source, theme }) => {
  requireScene('chart');
  const f = useCurrentFrame();
  const g = groundOf(theme);
  const t = tones(g);
  const C = PACK.composition;
  const max = Math.max(...bars.map((b) => b.v), 1);
  const pitch = Math.min(280, ROOM / bars.length);
  const thick = Math.round(Math.min(124, pitch * 0.44));
  const valueSize = Math.round(Math.min(150, thick * 1.2));
  // the bars leave room at their end for the widest value
  const room = MEASURE - valueSize * 0.62 * Math.max(...bars.map((b) => b.label.length)) - 30;
  const quiet = mixHex(t.head, PACK.grounds[g].colour, 0.68);
  const drawn = (i: number) => tw(f, 18 + i * REVEAL.stagger * 2, 18 + i * REVEAL.stagger * 2 + REVEAL.dur * 1.6, glide);
  const rule = tw(f, 10, 10 + REVEAL.dur * 1.4, glide);
  // two bars read as a change: the second against the first, set at the rule's end once both have drawn
  const change = bars.length === 2 && bars[0].v > 0 ? Math.round(((bars[1].v - bars[0].v) / bars[0].v) * 100) : null;
  return (
    <AbsoluteFill>
      <Ground theme={g} />
      <div style={{ position: 'absolute', left: C.margin, right: C.margin, top: C.top, textAlign: C.align }}>
        <Rise i={0}><Lead size={64} colour={t.soft}>{lead}</Lead></Rise>
        <Rise i={1} style={{ marginTop: C.gap.tagline }}>
          <Fit><Heavy size={170} colour={t.head}>{title}</Heavy></Fit>
        </Rise>
        <div style={{ marginTop: C.gap.object * 0.6, height: 3, width: MEASURE * rule, background: t.head, marginLeft: C.align === 'center' ? (MEASURE * (1 - rule)) / 2 : 0 }} />
        <div style={{ position: 'relative', marginTop: C.gap.object * 0.8, height: pitch * (bars.length - 1) + NAME + thick, textAlign: 'left' }}>
          {/* the axis the bars grow from */}
          <div style={{ position: 'absolute', left: 0, top: NAME - 16, width: 2, height: pitch * (bars.length - 1) + thick + 32, background: t.rule, transform: `scaleY(${rule.toFixed(3)})`, transformOrigin: '0 0' }} />
          {bars.map((b, i) => {
            const p = drawn(i);
            const w = Math.max(0, (b.v / max) * room * p);
            const ink = b.win ? t.hero : quiet;
            const top = i * pitch;
            return (
              <div key={b.k} style={{ position: 'absolute', left: 0, top, width: MEASURE, height: pitch }}>
                <div style={{ position: 'absolute', left: 0, top: 0, opacity: Math.min(1, p * 3) }}>
                  <Label size={32} colour={b.win ? t.head : t.soft}>{b.k}</Label>
                </div>
                <div style={{ position: 'absolute', left: 0, top: NAME, height: thick, width: b.v > 0 ? w : 6, background: ink, opacity: b.v > 0 ? 1 : Math.min(1, p * 3) }} />
                <div style={{ position: 'absolute', left: (b.v > 0 ? w : 6) + 26, top: NAME, height: thick, display: 'flex', alignItems: 'center', opacity: Math.min(1, p * 3) }}>
                  <Heavy size={valueSize} colour={b.win ? t.hero : t.head} style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{counting(b.label, p)}</Heavy>
                </div>
                {change != null && i === 1 && (
                  // the change, set at the far end of the second bar's row once it has drawn
                  <div style={{ position: 'absolute', right: 0, top: NAME, height: thick, display: 'flex', alignItems: 'center', gap: 18, opacity: tw(p, 0.85, 1) }}>
                    <Label size={28} colour={t.soft}>change</Label>
                    <Heavy size={Math.round(valueSize * 0.62)} colour={t.hero}>{`${change > 0 ? '+' : change < 0 ? '−' : ''}${Math.abs(change)}%`}</Heavy>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {source && (
          <Rise i={bars.length + 2} from={18} style={{ marginTop: C.gap.object * 0.9 }}>
            <Label size={24} colour={t.soft}>{source}</Label>
          </Rise>
        )}
      </div>
    </AbsoluteFill>
  );
};
