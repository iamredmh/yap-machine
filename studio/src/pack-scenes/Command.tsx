import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { REVEAL } from '../engine/motion';
import { SIG } from '../engine/signature';
import { MEASURE, PACK, requireScene, voice } from '../engine/style';
import { textWidth } from '../engine/text';
import { cardStyle } from '../kit/card';
import { CardDecor } from '../kit/CardDecor';
import { Ground, type Theme } from '../kit/Ground';
import { Cursor, Mark, markInk } from '../kit/Mark';
import { Tile, TILE, type Shoot } from '../kit/Presenter';
import { Rise } from '../kit/Rise';
import { groundOf, tones } from '../kit/tones';

// The command: a scene type a pack brings (Terminal). A terminal window on the ground types a command at the prompt,
// a letter or two a frame, then prints what it outputs a line at a time, the line that matters picked out with the
// signature's mark, and ends on a fresh prompt with the cursor blinking. With a shoot the presenter sits under it, in
// the tile with its window chrome, so the two read as two windows on one screen.

export type CommandLine = { t: string; win?: boolean };
export type CommandProps = { command: string; output: CommandLine[]; title?: string; shoot?: Shoot; at?: number; theme?: Theme };

/** Letters typed a frame, and frames between printed lines. */
const TYPE_RATE = 2.2;
const PRINT = 4;
const BAR = 56;
const PAD = 40;

export const Command: React.FC<CommandProps> = ({ command, output, title, shoot, at = 0, theme }) => {
  requireScene('command');
  const f = useCurrentFrame();
  const g = groundOf(theme);
  const t = tones(g);
  const C = PACK.composition;
  // the code voice at a size every line fits the window at
  const longest = Math.max(...[`$ ${command}`, ...output.map((l) => `  ${l.t}`)].map((l) => textWidth(l, 1, 'code')));
  const size = Math.min(46, Math.floor((MEASURE - PAD * 2) / longest));
  const pitch = Math.round(size * 1.6);
  const h = BAR + PAD * 2 + pitch * (output.length + 2);
  // with the presenter, the window sits above the tile's chrome; without, it's centred over the caption lane
  const bar = SIG.chrome === 'window' ? 56 : 0;
  const top = shoot ? Math.max(C.top - 40, Math.min(C.top, TILE.y - bar - 44 - h)) : Math.round(760 - h / 2);
  const start = Math.round(REVEAL.dur * 0.4);
  const typed = Math.max(0, Math.min(command.length, Math.floor((f - start) * TYPE_RATE)));
  const done = start + Math.ceil(command.length / TYPE_RATE) + 4;
  const printed = f < done ? 0 : Math.min(output.length, 1 + Math.floor((f - done) / PRINT));
  const finished = printed === output.length && f >= done + output.length * PRINT;
  const code = (s: number): React.CSSProperties => ({ ...voice('code', s, { lh: 1 }), whiteSpace: 'pre' });
  const ground = PACK.grounds[g].colour;
  return (
    <AbsoluteFill>
      <Ground theme={g} />
      <div style={{ position: 'absolute', left: C.margin, top, width: MEASURE }}>
        <Rise i={0} kind="object">
          <div data-part="card" style={{ position: 'relative', width: MEASURE, height: h, ...cardStyle(MEASURE, h, g) }}>
            <div style={{ position: 'absolute', left: 0, top: 0, width: MEASURE, height: BAR, display: 'flex', alignItems: 'center', gap: 12, padding: '0 24px', boxShadow: `inset 0 -2px 0 ${t.rule}` }}>
              {[0, 1, 2].map((i) => <span key={i} style={{ width: 14, height: 14, background: i === 0 ? t.hero : t.rule, borderRadius: SIG.surface === 'terminal' ? 0 : 7 }} />)}
              <span style={{ ...code(24), marginLeft: 12, color: t.soft }}>{title ?? command.split(' ')[0]}</span>
            </div>
            <div style={{ position: 'absolute', left: PAD, top: BAR + PAD, right: PAD }}>
              <div style={{ ...code(size), height: pitch, color: t.head }}>
                <span style={{ color: t.hero }}>$ </span>
                {command.slice(0, typed)}
                {f < done && <Cursor colour={t.head} />}
              </div>
              {output.slice(0, printed).map((l, i) => (
                <div key={i} style={{ ...code(size), height: pitch, color: l.win ? t.head : t.soft }}>
                  {'  '}
                  {l.win && SIG.mark !== 'none' ? (
                    <span style={{ color: markInk(SIG.mark, t.hero, t.head, ground) }}><Mark hero={t.hero} at={done + i * PRINT} seed={i + 61}>{l.t}</Mark></span>
                  ) : (
                    <span style={l.win ? { color: t.hero } : undefined}>{l.t}</span>
                  )}
                </div>
              ))}
              {finished && (
                <div style={{ ...code(size), height: pitch, color: t.head }}>
                  <span style={{ color: t.hero }}>$ </span>
                  <Cursor colour={t.head} />
                </div>
              )}
            </div>
            <CardDecor w={MEASURE} h={h} theme={g} seed={43} />
          </div>
        </Rise>
      </div>
      {shoot && <Tile shoot={shoot} at={at} x={TILE.x} y={TILE.y} w={TILE.size} h={TILE.size} />}
    </AbsoluteFill>
  );
};
