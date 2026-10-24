import { PACK } from '../engine/style';
import SCENES from '../reel/scenes.json';
import { Chart } from './Chart';
import { Command } from './Command';
import { Doodle } from './Doodle';
import { Float } from './Float';
import { Slam } from './Slam';
import { Sticker } from './Sticker';
import { WordPop } from './WordPop';

// Scene types a pack can bring (pack `scenes.brings`), on top of the engine's shared scenes in src/scenes. Each one
// calls requireScene() first, so only a pack that declares it can render it. What each one is for, and its props, are in
// src/reel/scenes.json with the shared scenes.
export const PACK_SCENES = {
  'word-pop': { component: WordPop, job: SCENES['word-pop'].job },
  slam: { component: Slam, job: SCENES.slam.job },
  chart: { component: Chart, job: SCENES.chart.job },
  doodle: { component: Doodle, job: SCENES.doodle.job },
  command: { component: Command, job: SCENES.command.job },
  float: { component: Float, job: SCENES.float.job },
  sticker: { component: Sticker, job: SCENES.sticker.job },
} as const;

export type PackSceneId = keyof typeof PACK_SCENES;

for (const id of PACK.scenes.brings) {
  if (!(id in PACK_SCENES)) throw new Error(`Style pack "${PACK.id}" brings the scene type "${id}", which isn't registered in src/pack-scenes/index.ts`);
}
