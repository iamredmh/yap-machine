import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { rgba } from '../engine/colour';
import { glide, reveal, tw } from '../engine/motion';
import { SIG } from '../engine/signature';
import { leading, MEASURE, PACK, requireScene } from '../engine/style';
import { textWidth } from '../engine/text';
import { cardStyle } from '../kit/card';
import { CardDecor } from '../kit/CardDecor';
import { IconBadge } from '../kit/IconBadge';
import { Mark, markInk } from '../kit/Mark';
import { FULL, FullFrame, headIn, type Shoot } from '../kit/Presenter';
import { Rise } from '../kit/Rise';
import { tones } from '../kit/tones';
import { Heavy, Label, Lead } from '../kit/Voices';

// The float: a scene type a pack brings (Glass). The presenter stays in the room, full frame, while the focus pulls
// gently off them (soft, barely darker, drifting in), and a card of the pack's surface floats up in front of them,
// breathing up and down: a headline over a big number (the old one struck out beside it), or over a few facts. The
// card stands on the caption lane, over the mouth and chest and never above the eye line, so the person is still there,
// eyes and all, while it shows the point. Captions run under it.

export type FloatProps = {
  shoot: Shoot;
  at: number;
  title: string;
  lead?: string;
  value?: string;
  was?: string;
  facts?: { k: string; v: string; win?: boolean }[];
  icon?: string;
};

const PAD = 52;

export const Float: React.FC<FloatProps> = ({ shoot, at, title, lead, value, was, facts, icon }) => {
  requireScene('float');
  const f = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  // the card sits on the dark ground's tones: the footage behind it is pulled down to that
  const t = tones('dark');
  const focus = tw(f, 0, 16, reveal);
  const push = 1 + 0.04 * tw(f, 0, durationInFrames, glide);
  const w = MEASURE;
  const inner = w - PAD * 2;
  const badge = !!icon && SIG.icons !== 'none';
  const valueSize = value ? Math.min(220, Math.floor((inner * (was ? 0.6 : 0.86)) / textWidth(value, 1, 'display', -0.02))) : 0;
  // a card with only its headline (an opener) sets it larger
  const titleSize = Math.min(value || facts ? 116 : 170, Math.floor((inner * 0.92) / textWidth(title, 1, 'display', -0.02)));
  const rowH = 84;
  // the card's height, from the line boxes of what it holds (the voices' own leading); the icon sits beside the lead-in
  const line = (size: number) => size * leading(0.9, 'display');
  const leadH = lead || badge ? Math.max(lead ? 48 * leading(1.1, 'accent') : 0, badge ? 72 : 0) : 0;
  const h = Math.round(PAD * 2 + 16 + (leadH ? leadH + 12 : 0) + line(titleSize) + (value ? 28 + line(valueSize) : 0) + (facts ? 30 + facts.length * (rowH + 12) - 12 : 0));
  // the card stands on the caption lane, over the mouth and chest. Its top keeps clear of the eyes, drift included: a
  // card too tall for that room (a fourth fact, a long headline, a presenter framed low) is drawn smaller, down to 60%,
  // rather than higher
  const head = headIn(shoot);
  const DRIFT = 9;
  const foot = PACK.subtitles.laneY - PACK.subtitles.size - 44;
  const fit = Math.max(0.6, Math.min(1, (foot - Math.max(160, head.eyes + 60 + DRIFT)) / h));
  const top = Math.round(foot - h * fit);
  const drift = Math.sin((f / 30) * 1.1) * DRIFT;
  const marked = SIG.mark !== 'none';
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <AbsoluteFill style={{ filter: `blur(${(9 * focus).toFixed(1)}px) brightness(${(1 - 0.1 * focus).toFixed(3)}) saturate(${(1 + 0.15 * focus).toFixed(3)})`, transform: `scale(${(push + 0.02 * focus).toFixed(4)})`, transformOrigin: `50% ${(head.eyes / 19.2).toFixed(1)}%` }}>
        <FullFrame shoot={shoot} at={at} k={FULL.k} crownY={FULL.crownY} />
      </AbsoluteFill>
      {/* the room darkens toward the card (the chest, not the face), so its glass reads */}
      <AbsoluteFill style={{ background: `radial-gradient(ellipse 85% 40% at 50% ${((top + h * fit * 0.6) / 19.2).toFixed(1)}%, ${rgba(PACK.palette.base, 0.4 * focus)}, transparent 75%)` }} />
      <div style={{ position: 'absolute', left: (1080 - w) / 2, top, width: w, transform: `translateY(${drift.toFixed(1)}px)${fit < 1 ? ` scale(${fit.toFixed(4)})` : ''}`, transformOrigin: '50% 0' }}>
        <Rise i={0} from={4} kind="object">
          <div data-part="card" style={{ position: 'relative', width: w, height: h, ...cardStyle(w, h, 'dark'), transform: undefined }}>
            <CardDecor w={w} h={h} theme="dark" seed={19} />
            <div style={{ position: 'absolute', left: PAD, right: PAD, top: PAD, textAlign: 'center' }}>
              {leadH > 0 && (
                <Rise i={0} from={8} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 20, height: leadH }}>
                  {badge && <IconBadge name={icon!} theme="dark" size={72} />}
                  {lead && <Lead size={48} colour={t.soft}>{lead}</Lead>}
                </Rise>
              )}
              <Rise i={1} from={8} style={{ marginTop: leadH ? 12 : 0, height: line(titleSize) }}>
                <Heavy size={titleSize} colour={t.head}>{title}</Heavy>
              </Rise>
              {value && (
                <Rise i={2} from={8} style={{ marginTop: 28, height: line(valueSize), display: 'flex', justifyContent: 'center', alignItems: 'baseline', gap: 32 }}>
                  {was && <Heavy size={Math.round(valueSize * 0.42)} colour={t.soft} style={{ textDecoration: 'line-through', textDecorationThickness: 5 }}>{was}</Heavy>}
                  {marked ? (
                    <Heavy size={valueSize} colour={markInk(SIG.mark, t.hero, t.head, PACK.cards.dark.fill)}>
                      <Mark hero={t.hero} at={20} seed={47}>{value}</Mark>
                    </Heavy>
                  ) : (
                    <Heavy size={valueSize} colour={t.hero}>{value}</Heavy>
                  )}
                </Rise>
              )}
              {facts && (
                <div style={{ marginTop: 30 }}>
                  {facts.map((x, i) => (
                    <Rise key={x.k} i={2 + i} from={8} style={{ marginTop: i ? 12 : 0 }}>
                      <div style={{ position: 'relative', height: rowH, padding: '0 34px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', textAlign: 'left', ...cardStyle(inner, rowH, 'dark', 1) }}>
                        <Label size={24} colour={t.soft}>{x.k}</Label>
                        {x.win && marked ? (
                          <Heavy size={52} colour={markInk(SIG.mark, t.hero, t.head, PACK.cards.dark.fill)}><Mark hero={t.hero} at={22 + i * 4} seed={i + 5}>{x.v}</Mark></Heavy>
                        ) : (
                          <Heavy size={52} colour={x.win ? t.hero : t.head}>{x.v}</Heavy>
                        )}
                      </div>
                    </Rise>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Rise>
      </div>
    </AbsoluteFill>
  );
};
