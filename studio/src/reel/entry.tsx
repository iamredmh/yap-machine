import React from 'react';
import { Composition, registerRoot } from 'remotion';
import '../engine/fonts';
import '../pack-scenes';
import { PACK } from '../engine/style';
import { checkPlan, reelFrames, type ReelPlan } from './plan';
import { Reel } from './Reel';

// The reel: a whole video from a reel plan, passed as the input props (its `pack` and `hero` pick the pack and the
// hero colour), e.g. node scripts/render-reel.mjs plans/<video>.json, or
// npx remotion studio src/reel/entry.tsx --props=plans/<video>.json. Its length comes from the plan.

const SAMPLE: ReelPlan = {
  pack: PACK.id,
  shots: [{ scene: 'quote', frames: 90, props: { lines: ['A plan goes in,', 'a video', 'comes out.'], name: 'The reel entry', role: 'Pass a plan as the input props' } }],
};

const Root: React.FC = () => (
  <Composition
    id="Reel"
    component={Reel}
    width={1080}
    height={1920}
    fps={30}
    durationInFrames={90}
    defaultProps={SAMPLE}
    calculateMetadata={({ props }) => ({ durationInFrames: reelFrames(checkPlan(props, PACK)) })}
  />
);

registerRoot(Root);
