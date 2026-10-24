import type React from 'react';
import { getInputProps } from 'remotion';
import glass from '../packs/glass.json';
import ledger from '../packs/ledger.json';
import pop from '../packs/pop.json';
import sketch from '../packs/sketch.json';
import terminal from '../packs/terminal.json';
import volt from '../packs/volt.json';
import { METRICS } from './metrics';
import type { StylePack } from './pack';
import { REFERENCE } from './reference';

// The packs, and the one this render uses. A render picks its pack with the input prop `pack` ("volt", "ledger")
// and its hero colour with `hero` (a name from the pack's palette, or a hex); with neither it's the first pack and
// the first colour of its rotation. Module-level on purpose: Remotion sets input props before the bundle runs.

// Webpack's own `require`, which turns require.context() into the folder's files at bundle time.
declare const require: (() => unknown) & { context: (dir: string, deep: boolean, match: RegExp) => { keys(): string[]; (key: string): unknown } };

/**
 * Every pack in src/packs by its file name, a style downloaded from Style Studio included, so it renders by its id as
 * soon as it's unzipped in the engine's folder, with nothing to add here. Found when the engine is bundled with webpack,
 * as Remotion bundles it for renders and its Studio; anywhere else (the web app's Vite build, a script) it's none, and
 * the web app hands its pack over whole instead.
 */
const inFolder = (): Record<string, StylePack> => {
  if (typeof require !== 'function') return {};
  try {
    const files = require.context('../packs', false, /\.json$/);
    return Object.fromEntries(files.keys().map((k) => [k.replace(/^.*\//, '').replace(/\.json$/, ''), files(k) as StylePack]));
  } catch {
    return {};
  }
};

export const PACKS: Record<string, StylePack> = {
  volt: volt as unknown as StylePack,
  ledger: ledger as unknown as StylePack,
  sketch: sketch as unknown as StylePack,
  terminal: terminal as unknown as StylePack,
  glass: glass as unknown as StylePack,
  pop: pop as unknown as StylePack,
  ...inFolder(),
};

/**
 * A pack handed over whole, before the engine loads: the web app's live preview (web/) sets it, since a <Player> has
 * no input props at module level. Wins over `pack` and `hero`; renders and the Studio never set it.
 */
const handed = (): { pack: StylePack; hero?: string } | undefined =>
  typeof window === 'undefined' ? undefined : (window as unknown as { __STYLE_PACK__?: { pack: StylePack; hero?: string } }).__STYLE_PACK__;

/** The render's inputs: `pack` (an id in src/packs) or `packData` (a whole pack, for one that isn't there), and `hero`. */
const props = (): { pack?: string; hero?: string; packData?: StylePack } => {
  const h = handed();
  if (h) return { pack: h.pack.id, hero: h.hero, packData: h.pack };
  try {
    return getInputProps() as { pack?: string; hero?: string; packData?: StylePack };
  } catch {
    return {}; // a script importing the engine outside the Studio and a render
  }
};

export type VoiceName = 'display' | 'accent' | 'body' | 'label' | 'code';
export const VOICES: VoiceName[] = ['display', 'accent', 'body', 'label', 'code'];

/** Fail early, by name, on a pack that's missing a part (a hand-made or app-made pack). */
export const checkPack = (p: StylePack): StylePack => {
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('A style pack is a JSON object of its parts: { "id", "fonts", "type", "palette", ... }');
  const need = ['fonts', 'type', 'palette', 'grounds', 'cards', 'subtitles', 'composition', 'presenter', 'transitions', 'motion', 'pace', 'scenes'] as const;
  const name = `Style pack${p.id ? ` "${p.id}"` : ''}`;
  // each part a group of settings in { }, the fonts a list in [ ]: named here, not as the error the first read of it throws
  const shape = (v: unknown, list: boolean) => (list ? Array.isArray(v) : !!v && typeof v === 'object' && !Array.isArray(v));
  const wrong = need.filter((k) => k in p && !shape(p[k], k === 'fonts'));
  if (wrong.length) throw new Error(`${name}: ${wrong.map((k) => (k === 'fonts' ? 'fonts should be a list of font files, in [ ]' : `${k} should be a group of settings, in { }`)).join('; ')}`);
  const missing: string[] = need.filter((k) => !(k in p));
  for (const v of VOICES) {
    const voice = p.type?.[v];
    if (!shape(voice, false)) missing.push(`type.${v}`);
    else if (!Object.hasOwn(METRICS, voice.metrics)) missing.push(`type.${v}.metrics "${voice.metrics}" (register it in src/engine/metrics.ts)`);
    else if (!p.fonts?.some((f) => f?.family === voice.family)) missing.push(`a font file for ${v}'s family "${voice.family}"`);
  }
  if (missing.length) throw new Error(`${name} is missing: ${missing.join(', ')}`);
  return p;
};

const custom = props().packData;
const id = props().pack ?? Object.keys(PACKS)[0];
if (!custom && !PACKS[id]) throw new Error(`Unknown style pack "${id}": there's no src/packs/${id}.json. Packs: ${Object.keys(PACKS).join(', ')}`);

/** The pack this render uses. */
export const PACK: StylePack = checkPack(custom ?? PACKS[id]);
export const TYPE = PACK.type;
export const P = PACK.palette;

/** A colour by its role: a palette key ("win", "textSoft"), an extended name, "hero", or a hex / rgba() as is. */
export const packColour = (name: string, pack: StylePack = PACK): string => {
  if (name === 'hero') return heroColour(pack);
  const pal = pack.palette as unknown as Record<string, unknown>;
  if (typeof pal[name] === 'string') return pal[name] as string;
  return pack.palette.extended[name] ?? name;
};

/** This video's hero colour: the `hero` input prop, else the first of the pack's rotation. */
export const heroColour = (pack: StylePack = PACK): string => {
  const asked = props().hero ?? pack.palette.heroRotation[0] ?? 'win';
  return asked === 'hero' ? pack.palette.win : packColour(asked, pack);
};

export const HERO = heroColour();

/** A scene type a pack brings: its component calls this first, so a pack that didn't declare it can't render it. */
export const requireScene = (scene: string, pack: StylePack = PACK) => {
  if (!pack.scenes.brings.includes(scene)) {
    throw new Error(`The scene type "${scene}" comes with a style pack, and the "${pack.id}" pack doesn't bring it (it brings: ${pack.scenes.brings.join(', ') || 'none'}).`);
  }
};

// ── Type ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The size rule's scale on a voice's face: it renders this much larger or smaller to stand like the reference. */
export const voiceAdjust = (v: VoiceName, pack: StylePack = PACK): number => {
  const voice = pack.type[v];
  if (voice.layout.match === 'none') return 1;
  const face = METRICS[voice.metrics];
  return voice.layout.match === 'cap' ? REFERENCE.capHeight / face.capHeight : REFERENCE.xHeight / face.xHeight;
};

/** The CSS family a voice is set in: its size-matched copy of the face (src/engine/fonts.ts registers it). */
export const voiceFamily = (v: VoiceName, pack: StylePack = PACK) => (voiceAdjust(v, pack) === 1 ? pack.type[v].family : `${pack.type[v].family} ${v}`);

export const FONT: Record<VoiceName, string> = Object.fromEntries(VOICES.map((v) => [v, `'${voiceFamily(v)}', ${TYPE[v].fallback}`])) as Record<VoiceName, string>;

/** Letter-spacing for a voice: the scene's own (em) plus the pack's. */
export const track = (em: number, voice: VoiceName) => `${+(em + TYPE[voice].tracking).toFixed(4)}em`;

/** The case a scene asks for, unless the pack forces one for the voice. */
export const caseOf = (voice: VoiceName, asked: React.CSSProperties['textTransform'] = 'none') => (TYPE[voice].case === 'none' ? asked : TYPE[voice].case);

/** A voice's line height in em: the pack's pitch in cap or x heights, or the scene's own. */
export const leading = (em: number, voice: VoiceName) => {
  const lh = TYPE[voice].layout.lineHeight;
  if (lh == null) return em;
  return +(lh * (voice === 'body' || voice === 'accent' ? REFERENCE.xHeight : REFERENCE.capHeight)).toFixed(4);
};

/** A voice as style props: family, weight, size, tracking, case and leading, from the pack. */
export const voice = (v: VoiceName, size: number, opts: { trackEm?: number; lh?: number; caseAsked?: React.CSSProperties['textTransform']; weight?: number } = {}): React.CSSProperties => ({
  fontFamily: FONT[v],
  fontWeight: opts.weight ?? TYPE[v].weight,
  fontStyle: TYPE[v].style,
  fontSize: size,
  letterSpacing: track(opts.trackEm ?? 0, v),
  lineHeight: leading(opts.lh ?? 1, v),
  textTransform: caseOf(v, opts.caseAsked),
});

/** The measure a scene's stack has: the frame width minus the pack's margins. */
export const MEASURE = 1080 - 2 * PACK.composition.margin;
