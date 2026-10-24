import type { BeatKind, JoinKind, StylePack } from '../engine/pack';
import { ICON_NAMES } from '../kit/Icon';
import type { Shoot } from '../kit/Presenter';
import SCENES from './scenes.json';

// A reel plan: a whole video as data. The editing skill writes one per video (plans/<video>.json) and the reel entry
// (src/reel/entry.tsx) renders it, with the plan as the input props, so its `pack` and `hero` pick the pack and the
// hero colour. Shots tile the edit's timeline: the reel's frame n shows the edit's frame `from + n`.
//
// The engine refuses what it can't draw (checkPlan, below). The style's own rules (pace, captions, the opening, the
// hero rotation) are the skill's, and scripts/check-plan.mjs checks those.

export type SceneId = keyof typeof SCENES;
export type SceneDef = {
  kind: 'shared' | 'pack';
  job: string;
  /** The presenter layout the scene shows ('layout': the shot's own), or null for a graphic. */
  presenter: string | null;
  needsShoot: boolean;
  /** What's under the caption lane: the presenter's footage (or the ground without a shoot), the ground, or nothing (captions hide). */
  lane: 'presenter' | 'ground' | 'none';
  props: Record<string, { type: string; required: boolean; note: string }>;
};
export const SCENE_DEFS = SCENES as Record<SceneId, SceneDef>;

/** How a shot joins the one before it. */
export type Join = JoinKind;
export const JOINS: Join[] = ['cut', 'ease', 'zoom', 'flash', 'wipe', 'blur', 'glitch', 'whip'];

export type Shot = {
  scene: string;
  /** Length in frames (30 fps). */
  frames: number;
  /** The join from the shot before; 'cut' when left out. */
  in?: Join;
  props?: Record<string, unknown>;
  /** What the shot is for. Not rendered. */
  note?: string;
  /** The kind of beat the shot belongs to (the pack's `scenes.beats`), so check-plan can hold it to the style. Not rendered. */
  beat?: BeatKind;
};

/** A caption line on the reel's timeline. `*word*` marks the key word. */
export type Caption = { from: number; to: number; text: string };

export type ReelPlan = {
  pack: string;
  /** The video's hero colour: a name from the pack's palette, or a hex. */
  hero?: string;
  title?: string;
  /** The edit the presenter comes from, with the face measured in its pixels. */
  shoot?: Shoot;
  /** The edit's frame the reel starts on. */
  from?: number;
  /** The voice: an audio or video file in public/ that lines up with the edit, played from `from`. */
  audio?: string;
  captions?: Caption[];
  shots: Shot[];
};

/** A join's settings in the pack: on or off, and its length (a cut takes none). */
const joinSpec = (join: Join, pack: StylePack): { enabled: boolean; frames: number } => {
  const T = pack.transitions;
  if (join === 'cut') return { enabled: T.cut, frames: 0 };
  if (join === 'zoom') return T.zoomThrough;
  return T[join] ?? { enabled: false, frames: 0 };
};

/** Frames a join takes, and how many of them the shot before stays on under the new one (all but a flash). */
export const joinFrames = (join: Join, pack: StylePack): { frames: number; overlap: number } => {
  const { frames } = joinSpec(join, pack);
  return { frames, overlap: join === 'flash' ? 0 : frames };
};

export const joinOn = (join: Join, pack: StylePack) => joinSpec(join, pack).enabled;

export const reelFrames = (plan: ReelPlan) => plan.shots.reduce((a, s) => a + s.frames, 0);

/** Where each shot starts on the reel's timeline. */
export const shotStarts = (plan: ReelPlan) => plan.shots.reduce<number[]>((a, s, i) => [...a, i ? a[i - 1] + plan.shots[i - 1].frames : 0], []);

/** Refuse, by name, a plan the engine can't render in this pack. */
export const checkPlan = (plan: ReelPlan, pack: StylePack): ReelPlan => {
  const problems: string[] = [];
  if (plan.pack !== pack.id) problems.push(`the plan is for the "${plan.pack}" pack and this render uses "${pack.id}": pass the plan as the input props, so its pack picks the pack`);
  if (!plan.shots?.length) problems.push('the plan has no shots');
  (plan.shots ?? []).forEach((s, i) => {
    const at = `shot ${i + 1} (${s.scene})`;
    const def = SCENE_DEFS[s.scene as SceneId];
    if (!def) {
      problems.push(`${at}: no such scene; scenes: ${Object.keys(SCENE_DEFS).join(', ')}`);
      return;
    }
    if (def.kind === 'pack' && !pack.scenes.brings.includes(s.scene)) problems.push(`${at}: the scene comes with a style pack, and "${pack.id}" doesn't bring it`);
    if (!Number.isInteger(s.frames) || s.frames < 1) problems.push(`${at}: frames must be a whole number above 0`);
    const props = s.props ?? {};
    for (const [k, p] of Object.entries(def.props)) if (p.required && props[k] == null) problems.push(`${at}: needs props.${k}`);
    for (const k of Object.keys(props)) {
      if (!(k in def.props)) problems.push(`${at}: takes no prop "${k}" (it takes ${Object.keys(def.props).join(', ')}${k === 'sub' ? '; captions go in the plan\'s captions' : ''})`);
    }
    // an icon the set doesn't have would come out as a stand-in, not as the one asked for
    if (props.icon != null && !ICON_NAMES.includes(props.icon as string)) problems.push(`${at}: no icon "${props.icon}" (icons: ${ICON_NAMES.join(', ')})`);
    if (def.needsShoot && !plan.shoot) problems.push(`${at}: shows the presenter, so the plan needs a shoot`);
    const join = s.in ?? 'cut';
    if (!JOINS.includes(join)) problems.push(`${at}: no such join "${join}" (${JOINS.join(', ')})`);
    else if (!joinOn(join, pack)) problems.push(`${at}: joins with "${join}", which the ${pack.name} pack has off`);
    if (join !== 'cut' && joinFrames(join, pack).overlap > (plan.shots[i - 1]?.frames ?? Infinity)) problems.push(`${at}: its ${join} is longer than the shot before`);
    if (s.scene === 'talk') {
      const layout = props.layout as keyof StylePack['presenter']['layouts'];
      if (!['full', 'halfBand', 'tile'].includes(layout)) problems.push(`${at}: layout must be full, halfBand or tile`);
      else if (!pack.presenter.layouts[layout]) problems.push(`${at}: the ${pack.name} pack doesn't use the ${layout} layout`);
    }
  });
  const end = plan.shots?.length ? reelFrames(plan) : 0;
  (plan.captions ?? []).forEach((c, i) => {
    if (!(c.from < c.to)) problems.push(`caption ${i + 1} ("${c.text}"): from must come before to`);
    if (c.from < 0 || c.to > end) problems.push(`caption ${i + 1} ("${c.text}"): runs outside the reel (0 to ${end})`);
  });
  if (problems.length) throw new Error(`The reel plan can't render:\n- ${problems.join('\n- ')}`);
  return plan;
};
