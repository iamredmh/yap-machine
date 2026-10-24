import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { expoOut, tw } from '../engine/motion';
import { SIG } from '../engine/signature';
import { PACK } from '../engine/style';
import { Fit } from '../kit/Fit';
import { Ground, type Theme } from '../kit/Ground';
import { BAND, FULL, FullFrame, HalfBand, Tile, TILE, type Shoot } from '../kit/Presenter';
import { Rise } from '../kit/Rise';
import { groundOf, tones } from '../kit/tones';
import { Heavy, Label } from '../kit/Voices';

// The presenter talking, in one of the pack's layouts: full frame on their room (with punch-ins on the pack's punch),
// the half band under a heading, or a tile under a heading. Captions come from the reel, not the scene.

export type TalkProps = {
  shoot: Shoot;
  at: number;
  layout: 'full' | 'halfBand' | 'tile';
  /** Full frame: frames where the frame punches in, then back out at the next, and so on. */
  punches?: number[];
  label?: string;
  head?: string;
  theme?: Theme;
};

/** The zoom at frame f: each punch toggles between wide and pushed in, over the pack's punch frames. */
const zoomAt = (f: number, punches: number[]) => {
  const P = PACK.motion.punch;
  const past = punches.filter((p) => p <= f).sort((a, b) => a - b);
  if (!past.length) return 1;
  const p = tw(f, past[past.length - 1], past[past.length - 1] + P.frames, expoOut);
  return 1 + P.amount * (past.length % 2 ? p : 1 - p);
};

export const Talk: React.FC<TalkProps> = ({ shoot, at, layout, punches = [], label, head, theme }) => {
  const f = useCurrentFrame();
  if (layout === 'full') {
    return (
      <AbsoluteFill style={{ backgroundColor: '#000' }}>
        <FullFrame shoot={shoot} at={at} k={FULL.k} crownY={FULL.crownY} zoom={zoomAt(f, punches)} />
      </AbsoluteFill>
    );
  }
  const g = groundOf(theme);
  const t = tones(g);
  const C = PACK.composition;
  // the heading sits in the middle of the ground above the presenter (clear of the band's caption seam, or the tile's
  // chrome), not pinned to the top with the ground empty under it
  const above = layout === 'halfBand' ? BAND.top - 90 : TILE.y - (SIG.chrome === 'window' ? 56 : SIG.chrome === 'tape' ? 24 : 0) - 60;
  return (
    <AbsoluteFill>
      <Ground theme={g} />
      <div style={{ position: 'absolute', left: C.margin, right: C.margin, top: C.top, height: above - C.top, display: 'flex', flexDirection: 'column', justifyContent: 'center', textAlign: C.align }}>
        {label && (
          <Rise i={0}>
            <Label size={30} colour={t.label}>{label}</Label>
          </Rise>
        )}
        {head && (
          <Rise i={1} style={{ marginTop: label ? C.gap.eyebrow : 0 }}>
            <Fit><Heavy size={190} colour={t.head}>{head}</Heavy></Fit>
          </Rise>
        )}
      </div>
      {layout === 'halfBand' ? (
        <HalfBand shoot={shoot} at={at} top={BAND.top} />
      ) : (
        <Tile shoot={shoot} at={at} x={TILE.x} y={TILE.y} w={TILE.size} h={TILE.size} />
      )}
    </AbsoluteFill>
  );
};
