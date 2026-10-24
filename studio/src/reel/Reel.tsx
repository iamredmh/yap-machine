import React from 'react';
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { expoOut, glide, leave, reveal, tw } from '../engine/motion';
import { SIG } from '../engine/signature';
import { packColour, PACK } from '../engine/style';
import { Sub, SubKey } from '../kit/Subtitle';
import { overFootage } from '../kit/contrast';
import { BackdropTurn } from '../kit/Ground';
import { BAND } from '../kit/Presenter';
import { rng, tornEdge } from '../kit/rough';
import { groundOf } from '../kit/tones';
import { PACK_SCENES } from '../pack-scenes';
import { ListItem } from '../scenes/ListItem';
import { QuoteCard } from '../scenes/QuoteCard';
import { StatCompare } from '../scenes/StatCompare';
import { Talk } from '../scenes/Talk';
import { TitleStack } from '../scenes/TitleStack';
import { checkPlan, joinFrames, SCENE_DEFS, shotStarts, type Join, type ReelPlan, type SceneId } from './plan';

// A whole video from a reel plan (src/reel/plan.ts): the shots in order on the edit's timeline, each joined to the one
// before by the pack's joins, the caption track over them, and the voice under them.

const COMPONENTS = {
  title: TitleStack,
  talk: Talk,
  list: ListItem,
  stat: StatCompare,
  quote: QuoteCard,
  ...Object.fromEntries(Object.entries(PACK_SCENES).map(([id, s]) => [id, s.component])),
} as Record<SceneId, React.FC<any>>;

/** A torn paper edge running down the frame at x, for a wipe on a torn signature edge: [x, y] points, top to bottom. */
const tornDown = (x: number) => tornEdge(1920, 0, 30, 61).map(([y, dx]) => [x + dx, y] as const);

/** Horizontal bands the frame tears into on a glitch at frame f: a polygon per set, the even bands or the odd. */
const glitchBands = (f: number, odd: boolean) => {
  const r = rng(f * 977 + 13);
  const cuts = [0];
  while (cuts[cuts.length - 1] < 1920) cuts.push(Math.min(1920, cuts[cuts.length - 1] + 40 + r() * 220));
  const rects = cuts.slice(0, -1).map((y, i) => [y, cuts[i + 1]] as const).filter((_, i) => i % 2 === (odd ? 1 : 0));
  return `polygon(${rects.map(([a, b]) => `0 ${a.toFixed(0)}px, 1080px ${a.toFixed(0)}px, 1080px ${b.toFixed(0)}px, 0 ${b.toFixed(0)}px, 0 ${a.toFixed(0)}px`).join(', ')})`;
};

/** A blur along x only, for a whip pan: an SVG filter the shot's style points at. */
const WhipBlur: React.FC<{ id: string; amount: number }> = ({ id, amount }) => (
  <svg width={0} height={0} style={{ position: 'absolute' }}>
    <filter id={id} x="-10%" y="0" width="120%" height="100%">
      <feGaussianBlur stdDeviation={`${amount.toFixed(1)} 0`} />
    </filter>
  </svg>
);

/**
 * A shot arriving on its join and, while the next one arrives, leaving under it. A join's look is the pack's: a wipe
 * leads with the band's rule (torn paper on a torn signature edge), a glitch fringes in the hero colour.
 */
const ShotFrame: React.FC<{ join: Join; next: Join | null; frames: number; children: React.ReactNode }> = ({ join, next, frames, children }) => {
  const f = useCurrentFrame();
  const id = `whip${React.useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const T = PACK.transitions;
  const len = joinFrames(join, PACK).frames;
  const out = next ? joinFrames(next, PACK).frames : 0;
  let style: React.CSSProperties = {};
  let over: React.ReactNode = null;
  let blur = 0;
  if (join === 'ease') {
    const p = tw(f, 0, len, reveal);
    style = { transform: `translateY(${((1 - p) * T.ease.dy).toFixed(1)}px)`, opacity: Math.min(1, p * 1.6) };
  } else if (join === 'zoom') {
    const p = tw(f, 0, len, expoOut);
    style = { transform: `scale(${(1.25 - 0.25 * p).toFixed(4)})`, opacity: Math.min(1, p * 2) };
  } else if (join === 'wipe' && f < len) {
    const x = 1080 * (1 - tw(f, 0, len, glide));
    if (SIG.edge === 'torn') {
      const rip = tornDown(x);
      style = { clipPath: `polygon(${rip.map(([a, b]) => `${a.toFixed(0)}px ${b.toFixed(0)}px`).join(', ')}, 1100px 1920px, 1100px 0px)` };
      over = (
        <svg width={1080} height={1920} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
          <polyline points={rip.map(([a, b]) => `${a + 5},${b}`).join(' ')} fill="none" stroke="#FFFFFF" strokeWidth={8} strokeLinejoin="round" />
        </svg>
      );
    } else {
      const rule = PACK.presenter.halfBand.rule;
      style = { clipPath: `inset(0 0 0 ${x.toFixed(1)}px)` };
      over = <div style={{ position: 'absolute', top: 0, bottom: 0, left: x, width: Math.max(3, rule?.width ?? 4), background: packColour(rule?.colour ?? 'hero') }} />;
    }
  } else if (join === 'blur') {
    const p = tw(f, 0, len, reveal);
    style = { opacity: Math.min(1, p * 1.25), filter: p < 1 ? `blur(${((1 - p) * 30).toFixed(1)}px)` : undefined, transform: `scale(${(1.05 - 0.05 * p).toFixed(4)})` };
  } else if (join === 'glitch' && f < len) {
    const k = 1 - f / len;
    const r = rng(f * 31 + 7);
    const dx = (r() * 2 - 1) * 70 * k;
    style = { clipPath: f < len - 1 ? glitchBands(f, false) : undefined, transform: `translateX(${dx.toFixed(1)}px)` };
    over = f < len - 1 && (
      // the other bands, the new shot again pushed the other way and tinted, and two thin bars of the hero colour
      <>
        <AbsoluteFill style={{ clipPath: glitchBands(f, true), transform: `translateX(${(-dx * 1.4).toFixed(1)}px)`, filter: 'hue-rotate(160deg) saturate(2.2)', opacity: 0.75 }}>{children}</AbsoluteFill>
        {[0, 1].map((i) => <div key={i} style={{ position: 'absolute', left: 0, right: 0, top: r() * 1920, height: 4 + r() * 10, background: packColour('hero'), opacity: 0.7, mixBlendMode: 'screen' }} />)}
      </>
    );
  } else if (join === 'whip' && f < len) {
    const p = tw(f, 0, len, glide);
    blur = 70 * Math.sin(Math.PI * p);
    style = { transform: `translateX(${(1080 * (1 - p)).toFixed(1)}px)`, filter: blur > 0.5 ? `url(#${id})` : undefined };
  }
  if (f >= frames && next === 'ease') {
    style = { transform: `scale(${(1 - T.ease.sink * tw(f, frames, frames + out, glide)).toFixed(4)})` };
  } else if (f >= frames && next === 'zoom') {
    const p = tw(f, frames, frames + out, leave);
    style = { transform: `scale(${(1 + 0.4 * p).toFixed(4)})`, filter: `blur(${(10 * p).toFixed(1)}px)` };
  } else if (f >= frames && next === 'wipe') {
    style = { transform: `translateX(${(-140 * tw(f, frames, frames + out, glide)).toFixed(1)}px)` };
  } else if (f >= frames && next === 'blur') {
    const p = tw(f, frames, frames + out, glide);
    style = { filter: `blur(${(30 * p).toFixed(1)}px)`, transform: `scale(${(1 + 0.05 * p).toFixed(4)})` };
  } else if (f >= frames && next === 'glitch') {
    style = { transform: `translateX(${((f % 2 ? 1 : -1) * 26).toFixed(0)}px)`, filter: 'saturate(1.8) contrast(1.3)' };
  } else if (f >= frames && next === 'whip') {
    const p = tw(f, frames, frames + out, glide);
    blur = 70 * Math.sin(Math.PI * p);
    style = { transform: `translateX(${(-1080 * p).toFixed(1)}px)`, filter: blur > 0.5 ? `url(#${id})` : undefined };
  }
  return (
    <AbsoluteFill>
      {blur > 0.5 && <WhipBlur id={id} amount={blur} />}
      <AbsoluteFill style={style}>{children}</AbsoluteFill>
      {over}
      {join === 'flash' && f < T.flash.frames && <AbsoluteFill style={{ background: packColour(T.flash.colour), opacity: 0.85 }} />}
    </AbsoluteFill>
  );
};

/** The caption line at this frame, styled for what's under the lane, hidden over a scene that shows its own words. */
const Captions: React.FC<{ plan: ReelPlan; starts: number[] }> = ({ plan, starts }) => {
  const f = useCurrentFrame();
  const c = plan.captions?.find((x) => f >= x.from && f < x.to);
  if (!c) return null;
  let i = 0;
  while (i + 1 < starts.length && starts[i + 1] <= f) i++;
  // while a shot comes in over the one before (a wipe, a blur, a whip), the line is styled for the old one until the
  // join's midpoint: most of the lane is still the old shot, and a line with no backing must read on what's under it
  if (i > 0 && f < starts[i] + joinFrames(plan.shots[i].in ?? 'cut', PACK).overlap / 2) i--;
  const shot = plan.shots[i];
  const def = SCENE_DEFS[shot.scene as SceneId];
  if (def.lane === 'none') return null;
  const footage = def.lane === 'presenter' && !!plan.shoot;
  // over footage the line takes the variant the footage under it calls for (a white shirt reads like a light ground)
  const light = footage ? overFootage(plan.shoot).light : groundOf(shot.props?.theme as 'dark' | 'light' | undefined) === 'light';
  // over the band (a title, or talk in the band) the line rides the band's top edge, so it never crosses the face
  const band = !!plan.shoot && (def.presenter === 'halfBand' || (def.presenter === 'layout' && shot.props?.layout === 'halfBand'));
  return (
    <Sub light={band ? PACK.composition.ground === 'light' : light} y={band ? BAND.top : undefined} seam={band} since={f - c.from} edge={footage && !band ? overFootage(plan.shoot).edge : undefined}>
      {c.text.split(/\*([^*]+)\*/).map((part, j) => (j % 2 ? <SubKey key={j}>{part}</SubKey> : part))}
    </Sub>
  );
};

export const Reel: React.FC<ReelPlan> = (plan) => {
  checkPlan(plan, PACK);
  const starts = shotStarts(plan);
  const from = plan.from ?? 0;
  // each shot that shows the ground takes the pack's next backdrop (full frame on the presenter shows none)
  let shown = 0;
  const turns = plan.shots.map((s) => {
    const def = SCENE_DEFS[s.scene as SceneId];
    const full = def.presenter === 'full' || (def.presenter === 'layout' && s.props?.layout === 'full');
    return full ? shown : shown++;
  });
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {plan.shots.map((s, i) => {
        const def = SCENE_DEFS[s.scene as SceneId];
        const Scene = COMPONENTS[s.scene as SceneId];
        const next = plan.shots[i + 1] ? (plan.shots[i + 1].in ?? 'cut') : null;
        const overlap = next ? joinFrames(next, PACK).overlap : 0;
        const presenter = def.presenter && plan.shoot ? { shoot: plan.shoot, at: from + starts[i] } : {};
        return (
          // premounted, so a shot's footage has loaded before it's on screen when the reel plays in a player (renders
          // don't premount: they wait for every frame anyway)
          <Sequence key={i} from={starts[i]} durationInFrames={s.frames + overlap} premountFor={45} name={`${i + 1} ${s.scene}`}>
            <BackdropTurn.Provider value={turns[i]}>
              <ShotFrame join={s.in ?? 'cut'} next={next} frames={s.frames}>
                <Scene {...s.props} {...presenter} />
              </ShotFrame>
            </BackdropTurn.Provider>
          </Sequence>
        );
      })}
      <Captions plan={plan} starts={starts} />
      {plan.audio && <Audio src={staticFile(plan.audio)} trimBefore={from} />}
    </AbsoluteFill>
  );
};
