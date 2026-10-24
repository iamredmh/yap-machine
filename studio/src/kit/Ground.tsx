import React from 'react';
import { AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { rgba } from '../engine/colour';
import type { GroundSpec } from '../engine/pack';
import { packColour, PACK } from '../engine/style';
import { BackdropLayer } from './Backdrop';

export type Theme = 'dark' | 'light';

/**
 * Which of the pack's backdrops this shot draws: the reel sets it per shot that shows the ground, so a pack with several
 * takes them in turn. Outside a reel it's the first.
 */
export const BackdropTurn = React.createContext(0);

/** The pack's backdrop for this turn on this ground, if the pack has backdrops. */
const PackBackdrop: React.FC<{ theme: Theme }> = ({ theme }) => {
  const turn = React.useContext(BackdropTurn);
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const list = PACK.backdrops!;
  const spec = list[((turn % list.length) + list.length) % list.length];
  const colours = {
    line: theme === 'dark' ? PACK.palette.text : PACK.palette.ink,
    hero: packColour('hero'),
    fields: spec.kind === 'aurora' || spec.kind === 'mesh' ? spec.colours.map((c) => packColour(c)) : [],
  };
  return <BackdropLayer spec={spec} theme={theme} colours={colours} frame={frame} fps={fps} width={width} height={height} />;
};

/** The pack's ground: its colour or photo texture, its backdrop (or its own pattern), its glows and its vignette. */
export const Ground: React.FC<{ theme?: Theme; format?: '9x16' | '16x9' }> = ({ theme = 'dark', format = '9x16' }) => {
  const g: GroundSpec = PACK.grounds[theme];
  const backdrops = !!PACK.backdrops?.length;
  const pt = backdrops ? null : g.pattern;
  const line = pt ? rgba(pt.colour, pt.alpha) : '';
  const pattern: React.CSSProperties | undefined = !pt
    ? undefined
    : pt.kind === 'grid'
      ? { backgroundImage: `linear-gradient(${line} 1px, transparent 1px), linear-gradient(90deg, ${line} 1px, transparent 1px)`, backgroundSize: `${pt.size}px ${pt.size}px`, backgroundPosition: 'center center' }
      : { backgroundImage: `radial-gradient(${line} 1.6px, transparent 1.8px)`, backgroundSize: `${pt.size}px ${pt.size}px`, backgroundPosition: 'center center' };
  const glows = g.glows.map((o) => `radial-gradient(${o.w}% ${o.h}% at ${o.x}% ${o.y}%, ${rgba(packColour(o.colour), o.alpha)}, transparent 70%)`).join(',');
  return (
    <>
      <AbsoluteFill data-part="ground" style={{ backgroundColor: g.colour }} />
      {g.texture && <Img src={staticFile(`grounds/${g.texture}-${format}.jpg`)} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />}
      {pattern && <AbsoluteFill style={pattern} />}
      {backdrops && <PackBackdrop theme={theme} />}
      {glows && <AbsoluteFill style={{ background: glows, mixBlendMode: theme === 'dark' ? 'screen' : 'multiply' }} />}
      {g.vignette && <AbsoluteFill style={{ background: g.vignette }} />}
    </>
  );
};
