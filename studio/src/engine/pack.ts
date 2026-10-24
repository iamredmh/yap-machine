// A style pack: everything about how a creator's videos look and move, as data. One engine (src/kit, src/scenes)
// reads one pack per render, picked with the input prop `pack` (src/engine/style.ts). Packs live in src/packs/.
//
// Who reads what:
//   engine  read by code. Change it and the render changes.
//   skill   read by the editing skill when it plans a video (which layouts, scenes, transitions, pace). The code
//           doesn't enforce them: they are the style's rules, in data.

export type Hex = string;

/** A font file in the public folder. */
export type FontFace = {
  family: string;
  /** Path in the public folder, e.g. "fonts/volt/Anton-Regular.woff2". */
  file: string;
  /** The weights this file answers for: "400", or a range "200 800" for a variable face. */
  weight: string;
  style?: 'normal' | 'italic';
};

/**
 * Layout rules for one face. A size in a scene means "a face whose cap height is 0.7 of this", the engine's
 * reference (src/engine/reference.ts), so a scene is drawn once and every pack's faces meet it.
 */
export type VoiceLayout = {
  /**
   * The size rule (engine). 'cap': the face is scaled so its cap height is the reference's at the same font size
   * (headlines, labels); 'x': so its x-height is (body, lead-ins); 'none': its own size. Done in the font itself
   * (a CSS size-adjust, with the reference's ascent and descent), so every site follows it.
   */
  match: 'cap' | 'x' | 'none';
  /**
   * Display only (engine): a line given a measure. 'width' scales it to fill the measure exactly (lines in a stack read
   * as one block); 'cap' keeps the drawn size times `fitScale`, and only shrinks a line that would pass `measure`.
   */
  fit: 'width' | 'cap';
  fitScale: number;
  /** Display: the share of the measure a line may take. Body: characters per line for text the engine breaks. Null: the scene's. */
  measure: number | null;
  /** Line pitch in cap heights (x-heights for body and accent); null keeps the scene's. */
  lineHeight: number | null;
};

/** One of the voices scenes set type in. (engine) */
export type Voice = {
  family: string;
  /** CSS generic fallback: sans-serif, serif or monospace. */
  fallback: string;
  /** The voice's weight. */
  weight: number;
  style: 'normal' | 'italic';
  /** Letter-spacing in em, added to any a scene sets. */
  tracking: number;
  /** Forced case ('none' keeps what the scene asks for). */
  case: 'none' | 'uppercase' | 'lowercase';
  /** The face's letter metrics, a key of src/engine/metrics.ts (scripts/font_metrics.py). */
  metrics: string;
  layout: VoiceLayout;
};

export type Palette = {
  /** Dark neutrals, darkest first: the dark ground, then panel and surface, hairlines, two greys. */
  base: Hex;
  panel: Hex;
  surface: Hex;
  line: Hex;
  faint: Hex;
  muted: Hex;
  /** Type on dark: headlines, and the step-back colour for lead-ins and labels. */
  text: Hex;
  textSoft: Hex;
  /** Type on the light ground: headlines, and the step-back colour. */
  ink: Hex;
  inkSoft: Hex;
  /** The two meanings: the win (the after, the pick) and the friction (the before). */
  win: Hex;
  friction: Hex;
  /** Colours a video's hero colour can come from. */
  extended: Record<string, Hex>;
  /** (skill) the hero-colour rotation: one per video, never the last video's. Names from `extended`, or win / friction. */
  heroRotation: string[];
};

/** A coloured glow on a ground: centre and size in % of the frame. (engine) */
export type Glow = { x: number; y: number; w: number; h: number; colour: string; alpha: number };

export type GroundSpec = {
  colour: Hex;
  /** A photo texture in public/grounds, "<texture>-<format>.jpg"; null for a flat ground. */
  texture: string | null;
  glows: Glow[];
  /** A drawn pattern: a grid or dots every `size` px, in `colour` at `alpha`. */
  pattern: { kind: 'grid' | 'dots'; size: number; colour: Hex; alpha: number } | null;
  /** A CSS background laid over everything on the ground, or null. */
  vignette: string | null;
};

/**
 * A backdrop drawn on the ground behind a graphic scene, all in code. Its lines take the ground's type colour (text on
 * dark, ink on light) at `alpha`, its glows the hero colour; motion is slow and loops. (engine)
 *   grid      a fine square grid, faded toward the edges, with a soft glow and optional grain
 *   dots      a dot grid, faded, with optional corner ticks (a blueprint)
 *   horizon   a perspective floor grid running to a glowing horizon, drifting toward the viewer
 *   aurora    soft colour fields drifting slowly, in palette colours by name
 *   spotlight a soft light cone from above with a pool on the floor, swaying a little
 *   rings     concentric rings spreading slowly out from behind the stack
 *   paper     a sheet of paper: grid, ruled lines or dots, an optional margin line, grain
 *   scanlines a CRT: fine scan lines, a phosphor glow, a bright band rolling down
 *   halftone  printed dots growing toward a corner or the bottom
 *   mesh      saturated colour fields filling the frame, drifting (the glass look's ground)
 */
export type Backdrop =
  | { kind: 'plain' }
  | { kind: 'grid'; size: number; alpha: number; fade: number; glow: number; grain: number }
  | { kind: 'dots'; size: number; alpha: number; fade: number; ticks: boolean; glow: number; grain: number }
  | { kind: 'horizon'; size: number; alpha: number; horizon: number; speed: number; glow: number }
  | { kind: 'aurora'; colours: string[]; alpha: number; speed: number; grain: number }
  | { kind: 'spotlight'; alpha: number; sway: number }
  | { kind: 'rings'; size: number; alpha: number; speed: number; glow: number }
  | { kind: 'paper'; size: number; alpha: number; lines: 'grid' | 'ruled' | 'dots'; margin: boolean; grain: number }
  | { kind: 'scanlines'; size: number; alpha: number; glow: number; roll: number }
  | { kind: 'halftone'; size: number; alpha: number; from: 'corner' | 'bottom' }
  | { kind: 'mesh'; colours: string[]; alpha: number; speed: number; grain: number };

export type Shadow = { dx: number; dy: number; blur: number; colour: Hex; alpha: number };

/**
 * A style's signature: the details that make it its own rather than a recolour, read by the kit everywhere they apply.
 * (engine) Every field is optional; left out, the kit draws as it always has.
 */
export type Signature = {
  /** What cards and panels are: lit solid, frosted glass, paper with a hand-drawn border, neo-brutal (ink border, hard shadow), or a terminal panel. */
  surface: 'solid' | 'glass' | 'sketch' | 'brutal' | 'terminal';
  /**
   * How the hero word and the winning number are picked out: the hero colour alone (none), a marker highlight, a hand
   * underline, a scribbled circle, a filled box (with an ink border and shadow on a brutal surface), an inverted block
   * with a cursor, or a glow.
   */
  mark: 'none' | 'highlight' | 'underline' | 'circle' | 'box' | 'invert' | 'glow';
  /** How icons are drawn, or none: lines, duotone, solid, hand-drawn, pixels, or a sticker with a white edge. */
  icons: 'none' | 'line' | 'duotone' | 'solid' | 'sketch' | 'pixel' | 'sticker';
  /** How a line arrives: rises (the pack's motion), in steps like drawn animation, typed in, or out of a blur. */
  reveal: 'rise' | 'stepped' | 'type' | 'blur';
  /** What the presenter's tile wears: nothing, a window's title bar, or tape on its corners. */
  chrome: 'none' | 'window' | 'tape';
  /** The camera band's top edge: straight, or torn like paper. */
  edge: 'straight' | 'torn';
  /** Cards and the tile lean by this many degrees. */
  tilt: number;
  /** Hand-drawn strokes: how far they wobble (px), and how many frames each drawing holds before it's redrawn (0: never). */
  rough: number;
  boil: number;
};

/** Cards and panels on each ground. (engine) */
export type CardSpec = {
  /** Fill top to bottom (equal for a flat card), one step up inside a card, and one more. */
  top: Hex;
  fill: Hex;
  bottom: Hex;
  up: Hex;
  up2: Hex;
  radius: number;
  /** A 1px light catch along the top edge, as the alpha of the text colour; 0 for none. */
  lightCatch: number;
  /** The shadow at a 740 x 112 card; it scales with the card. */
  shadow: Shadow;
  ring: { width: number; colour: string } | null;
};

/** The spoken-word subtitles. (engine; words per line is skill) */
export type Subtitles = {
  voice: 'body' | 'display' | 'accent';
  weight: number;
  size: number;
  case: 'none' | 'uppercase' | 'lowercase';
  tracking: number;
  colour: { dark: Hex; light: Hex };
  /** A stroke round each letter, per ground, for subtitles straight on footage. */
  outline: { width: number; dark: Hex; light: Hex } | null;
  shadow: { dark: string | null; light: string | null };
  /**
   * What sits behind the line, its colour per ground: a soft scrim, a pill, nothing, a frosted glass pill, a box with
   * an ink border and a hard shadow, or a flat block with square corners.
   */
  backing: { kind: 'scrim' | 'pill' | 'none' | 'glass' | 'box' | 'block'; dark: string; light: string };
  /** The key word: its own voice and size, and optionally a box behind it. */
  key: {
    voice: 'body' | 'display' | 'accent';
    weight: number;
    style: 'normal' | 'italic';
    size: number;
    colour: string | null;
    box: { colour: string; radius: number; padX: number; padY: number; tilt: number; border?: { width: number; colour: string } } | null;
    /** Without a box: the key word marked by hand in the hero colour, a marker highlight or an underline. */
    mark?: 'highlight' | 'underline' | null;
  };
  /**
   * How each line arrives (engine): it cuts in (left out), pops in on the pack's spring, rises, is typed in, comes out
   * of a blur, or arrives in steps like drawn animation. Only the reel's caption track moves; a scene's own line holds.
   */
  enter?: 'cut' | 'pop' | 'rise' | 'type' | 'blur' | 'stepped';
  /** Centre of the subtitle lane, portrait px. */
  laneY: number;
  /** (skill) words on screen at once. */
  words: [number, number];
};

/** Where a scene's stack sits and how it lines up. (engine) */
export type Composition = {
  /** The ground scenes stand on unless a scene asks for the other. */
  ground: 'dark' | 'light';
  align: 'left' | 'center';
  /** Side margin, portrait px; the measure is the frame width minus both. */
  margin: number;
  /** Where a scene's stack starts, portrait px. */
  top: number;
  /** The gaps, px: eyebrow to title, title to tagline, text to an object. */
  gap: { eyebrow: number; tagline: number; object: number };
};

export type Presenter = {
  /** (skill) layouts a video may use, and the ones it may open on. */
  layouts: { full: boolean; halfBand: boolean; tile: boolean };
  openOn: Array<'full' | 'halfBand'>;
  /** (engine) the band's soft edges in px (0 = hard), and a rule along each. */
  halfBand: { feather: number; rule: { width: number; colour: string } | null };
  /** (engine) the tile's corners, ring and shadow (CSS box-shadow). */
  tile: { radius: number; ring: { width: number; colour: string } | null; shadow: string };
  /** Not drawn any more: the band and the tile keep the whole head inside, so no edge is broken. Kept so packs that set it still load. */
  rim: { colour: Hex; alpha: number; blur: number } | null;
};

/** How a shot joins the one before it. */
export type JoinKind = 'cut' | 'ease' | 'zoom' | 'flash' | 'wipe' | 'blur' | 'glitch' | 'whip';

export type Transitions = {
  cut: boolean;
  /** The gentle ease: the new shot rises `dy` px, the old one sinks `sink`, over `frames`. */
  ease: { enabled: boolean; dy: number; sink: number; frames: number };
  zoomThrough: { enabled: boolean; frames: number };
  /** A flat colour flash on a cut or a hit. (engine where a scene draws it) */
  flash: { enabled: boolean; colour: string; frames: number };
  /**
   * The joins a style can add (each optional; left out, it's off). wipe: the new shot wipes in from the right behind a
   * leading edge (the band's rule, or torn paper on a torn signature edge) while the old one drifts left. blur: the old
   * shot blurs away as the new one comes into focus. glitch: the frame tears into offset slices with colour fringes,
   * then settles on the new shot. whip: a whip pan, the old shot flying out sideways, smeared, as the new one flies in.
   */
  wipe?: { enabled: boolean; frames: number };
  blur?: { enabled: boolean; frames: number };
  glitch?: { enabled: boolean; frames: number };
  whip?: { enabled: boolean; frames: number };
};

/** How things move. (engine) */
export type Motion = {
  /** Arrivals: a cubic-bezier, its length in frames per line and the stagger between lines. */
  reveal: { bezier: [number, number, number, number]; frames: number; stagger: number };
  leave: [number, number, number, number];
  glide: [number, number, number, number];
  /** The landing spring: natural frequency per frame and damping ratio. */
  spring: { w: number; z: number };
  /** The punch-in on a stressed word: how far and over how many frames. */
  punch: { amount: number; frames: number };
  /** How far a line rises as it arrives, px. */
  rise: number;
};

/** The kinds of beat a talking-head short is made of, as the editing skill reads a transcript. */
export type BeatKind = 'hook' | 'payoff' | 'item' | 'number' | 'point' | 'proof' | 'end';

/**
 * (skill) How the style carries each kind of beat: the scenes it reaches for, first choice first ("talk:tile" names a
 * talk layout), and the join into the beat. A beat left out falls back to the shared scenes. This is where a style's
 * structure lives: which beats the face carries, which a graphic, and how they meet.
 */
export type Beats = Partial<Record<BeatKind, { use: string[]; in?: JoinKind }>>;

/** (skill) the pace numbers. */
export type Pace = {
  short: { secondsPerChange: [number, number]; punchIns: 'stressed-words' | 'every-line' | 'payoffs' };
  long: { secondsPerChange: [number, number] };
  endHoldMax: number;
  wordsPerMinute: [number, number];
};

export type StylePack = {
  id: string;
  name: string;
  description: string;
  fonts: FontFace[];
  /**
   * display: the headline voice. accent: the lead-in that steps aside. body: running text and subtitles. label:
   * eyebrows, counters, small caps lines. code: code inside a rebuilt interface.
   */
  type: { display: Voice; accent: Voice; body: Voice; label: Voice; code: Voice };
  palette: Palette;
  grounds: { dark: GroundSpec; light: GroundSpec };
  /**
   * Backdrops drawn on either ground in place of its `pattern`. With more than one, a video takes them in turn, one per
   * shot that shows the ground (the reel counts them); the board's scenes start from the first. Left out, the
   * grounds draw their own patterns.
   */
  backdrops?: Backdrop[];
  /** The style's signature details (see Signature); left out, the kit draws as it always has. */
  signature?: Partial<Signature>;
  /**
   * Word-pop's colours, for a pack that brings it. `words`: auto (white or ink, whichever reads on the footage under
   * them), white, black or the hero colour, each with an edge in the opposite tone. `key`: the key word on a box, on a
   * marker highlight, or in the hero colour. Left out: auto, and the key word as the captions mark theirs.
   */
  wordPop?: { words?: 'auto' | 'white' | 'black' | 'hero'; key?: 'box' | 'marker' | 'colour' };
  cards: { dark: CardSpec; light: CardSpec };
  subtitles: Subtitles;
  composition: Composition;
  presenter: Presenter;
  transitions: Transitions;
  motion: Motion;
  pace: Pace;
  /**
   * Scene types this pack brings on top of the engine's shared scenes, by id (src/pack-scenes). Only a pack that
   * declares one can render it. `avoid` (skill): shared scenes the style doesn't use. `beats` (skill): how the style
   * carries each kind of beat (see Beats).
   */
  scenes: { brings: string[]; avoid: string[]; beats?: Beats };
};
