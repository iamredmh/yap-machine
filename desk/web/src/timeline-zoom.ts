/** Zoom for the review timeline: which stretch of the cut is on screen, and the maths to move it. No DOM in here, so it is all unit-tested. */

/** The visible window, in seconds. The whole cut is { start: 0, end: duration }. */
export interface View { start: number; end: number }

/** The closest you can zoom: about two seconds across the timeline, which is a frame a few pixels wide and a word several tens. */
export const MIN_SPAN = 2;

export const fullView = (dur: number): View => ({ start: 0, end: Math.max(0, dur) });
export const spanOf = (v: View) => v.end - v.start;
export const isFull = (v: View, dur: number) => v.start <= 1e-6 && v.end >= dur - 1e-6;
/** How many times closer than the whole cut. */
export const zoomOf = (v: View, dur: number) => (spanOf(v) > 0 ? dur / spanOf(v) : 1);

/** The smallest window allowed: MIN_SPAN, or the whole cut when it is shorter than that. */
export const minSpan = (dur: number) => Math.min(MIN_SPAN, Math.max(0, dur));

/** Keeps a window inside the cut and between the closest and the widest zoom. */
export function clampView(v: View, dur: number): View {
  return place(v.start, spanOf(v), dur);
}

/** A window of `span` seconds starting at `start`, kept inside the cut and between the closest and the widest zoom. */
function place(start: number, span: number, dur: number): View {
  if (!(dur > 0)) return { start: 0, end: 0 };
  const s = Math.min(dur, Math.max(minSpan(dur), Number.isFinite(span) ? span : dur));
  const a = Math.min(Math.max(0, Number.isFinite(start) ? start : 0), dur - s);
  return { start: a, end: a + s };
}

/** Zooms by `factor` (above 1 is closer), keeping the moment at `anchor` under the same spot on screen. */
export function zoomAt(v: View, factor: number, anchor: number, dur: number): View {
  const span = spanOf(v);
  if (!(span > 0) || !(factor > 0)) return clampView(v, dur);
  const next = Math.min(dur, Math.max(minSpan(dur), span / factor));
  const frac = Math.min(1, Math.max(0, (anchor - v.start) / span));
  return place(anchor - frac * next, next, dur);
}

/** One press of + or -: a step of 2x about the anchor. */
export const ZOOM_STEP = 2;
export const zoomStep = (v: View, dir: 1 | -1, anchor: number, dur: number) => zoomAt(v, dir === 1 ? ZOOM_STEP : 1 / ZOOM_STEP, anchor, dur);

/** A wheel with ctrl held (that is how a trackpad pinch arrives in most browsers): a gentle exponential. */
export const wheelFactor = (deltaY: number) => Math.exp(-Math.max(-60, Math.min(60, deltaY)) * 0.012);

/** Moves the window by `dt` seconds, stopping at the ends of the cut. */
export function panBy(v: View, dt: number, dur: number): View {
  return place(v.start + dt, spanOf(v), dur);
}

/** Moves the window so it starts at `start`. */
export const panTo = (v: View, start: number, dur: number) => place(start, spanOf(v), dur);

/** Centres the window on a moment. */
export const centreOn = (v: View, t: number, dur: number) => panTo(v, t - spanOf(v) / 2, dur);

export interface Follow { playing: boolean }
/** Share of the window the playhead may enter before playback turns the page, and where it lands after. */
const EDGE = 0.08;
const LAND = 0.12;

/**
 * Where the window should be so the playhead is in it.
 * While playing, the page turns when the playhead nears the right edge (or has run off either end, as when a loop jumps back).
 * Paused (a frame step, a marker jump, a click elsewhere) it only moves when the playhead is out of sight, and then centres on it.
 */
export function follow(v: View, t: number, dur: number, f: Follow): View {
  const span = spanOf(v);
  if (!(span > 0) || span >= dur - 1e-6) return v;
  if (f.playing) {
    if (t >= v.start && t <= v.end - span * EDGE) return v;
    return panTo(v, t - span * LAND, dur);
  }
  if (t >= v.start && t <= v.end) return v;
  return centreOn(v, t, dur);
}

/** x (0..1) of a moment inside the window; below 0 or above 1 when it is off screen. */
export const xOf = (v: View, t: number) => (t - v.start) / spanOf(v);
/** The moment at x (0..1) of the window. */
export const timeOf = (v: View, x: number) => v.start + x * spanOf(v);
export const visible = (v: View, t: number, slack = 0) => t >= v.start - slack && t <= v.end + slack;
/** Does the stretch from..to touch the window? */
export const overlaps = (v: View, from: number, to: number) => to >= v.start && from <= v.end;

// ---- the ruler -------------------------------------------------------------------------------------

const STEPS = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];

/** The smallest "nice" tick spacing (seconds) that keeps labels at least `minGap` px apart. */
export function tickStepFor(span: number, width: number, minGap = 76): number {
  if (!(span > 0) || !(width > 0)) return STEPS[4];
  const need = (minGap / width) * span;
  return STEPS.find((s) => s >= need) ?? STEPS[STEPS.length - 1];
}

/** m:ss, or h:mm:ss from an hour up, with tenths (or hundredths) once the ticks are closer than a second. */
export function clockAt(t: number, step: number): string {
  t = Math.max(0, Number.isFinite(t) ? t : 0);
  const digits = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  const scaled = Math.round(t * 10 ** digits);
  const whole = Math.floor(scaled / 10 ** digits);
  const frac = digits ? "." + String(scaled % 10 ** digits).padStart(digits, "0") : "";
  const h = Math.floor(whole / 3600), m = Math.floor((whole % 3600) / 60), s = whole % 60;
  return (h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`) + frac;
}

/** Ruler ticks across the window, each with its place in it (0..1) and label. `minStep` limits label precision without changing the zoom. */
export function rulerTicksIn(v: View, width: number, minGap = 76, minStep = 0): { t: number; x: number; label: string }[] {
  const span = spanOf(v);
  if (!(span > 0)) return [];
  const step = Math.max(minStep, tickStepFor(span, width, minGap));
  const out: { t: number; x: number; label: string }[] = [];
  const first = Math.ceil(v.start / step - 1e-9);
  for (let i = first; i * step <= v.end + 1e-9; i++) {
    const t = Math.round(i * step * 1000) / 1000;
    out.push({ t, x: (t - v.start) / span, label: clockAt(t, step) });
  }
  return out;
}

/** The width of one video frame on screen, in px; the ruler draws frame ticks once this is at least `min`. */
export const framePx = (v: View, width: number, fps: number | null) => (fps && spanOf(v) > 0 ? (width * (1 / fps)) / spanOf(v) : 0);
export const showFrameTicks = (px: number, min = 6) => px >= min;

// ---- the waveform's level of detail ------------------------------------------------------------------

/** Peaks per second of each detail level (the overview file is separate, and coarser for a long cut). */
export const DETAIL_RATES = [5, 20, 80, 320];
/** Peaks in one tile. A tile of level L lasts TILE_PEAKS / rate seconds. */
export const TILE_PEAKS = 1024;
export const tileSeconds = (level: number) => TILE_PEAKS / DETAIL_RATES[level];

/** What to draw from: the overview (level null) when it has enough peaks for the bars on screen, else the coarsest detail level that does. */
export function pickLevel(span: number, bars: number, overviewRate: number): number | null {
  if (!(span > 0) || !(bars > 0)) return null;
  const need = bars / span;
  if (overviewRate >= need) return null;
  const i = DETAIL_RATES.findIndex((r) => r >= need);
  return i < 0 ? DETAIL_RATES.length - 1 : i;
}

/** The tiles of a level that the window touches, widened by `margin` of the window on each side so the next one is ready. */
export function tilesFor(level: number, v: View, dur: number, margin = 0): number[] {
  const len = tileSeconds(level);
  const span = spanOf(v);
  const from = Math.max(0, v.start - span * margin), to = Math.min(dur, v.end + span * margin);
  if (!(to > from)) return [];
  const a = Math.floor(from / len), b = Math.floor((to - 1e-9) / len);
  const out: number[] = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

/**
 * The loudest peak in t0..t1 from a level's tiles, or null when a tile that is needed isn't loaded yet
 * (the caller then falls back to the coarser overview for that bar).
 */
export function tileMax(level: number, tiles: { get(i: number): ArrayLike<number> | undefined }, t0: number, t1: number): number | null {
  const rate = DETAIL_RATES[level], len = tileSeconds(level);
  const a = Math.floor(t0 / len), b = Math.floor(Math.max(t0, t1 - 1e-9) / len);
  let max = 0;
  for (let i = a; i <= b; i++) {
    const tile = tiles.get(i);
    if (!tile) return null;
    const lo = Math.max(0, Math.floor((Math.max(t0, i * len) - i * len) * rate));
    const hi = Math.min(tile.length, Math.max(lo + 1, Math.ceil((Math.min(t1, (i + 1) * len) - i * len) * rate)));
    for (let k = lo; k < hi; k++) if (tile[k] > max) max = tile[k];
  }
  return max;
}

// ---- the minimap -----------------------------------------------------------------------------------

/** Dragging the window in the minimap: where it starts after the pointer has moved by `dx` of the minimap's width. */
export function dragWindow(v: View, dxFraction: number, dur: number): View {
  return panBy(v, dxFraction * dur, dur);
}

/** Dragging one edge of the window in the minimap changes the zoom. */
export function dragEdge(v: View, edge: "start" | "end", t: number, dur: number): View {
  const m = minSpan(dur);
  const at = Math.min(Math.max(0, t), dur);
  if (edge === "start") { const a = Math.min(at, v.end - m); return place(a, v.end - a, dur); }
  const b = Math.max(at, v.start + m);
  return place(v.start, b - v.start, dur);
}

/** A click on the minimap outside the window: centre the window there. */
export const jumpWindow = (v: View, t: number, dur: number) => centreOn(v, t, dur);

/** A drag the spacing between two touches: the factor to zoom by, and how far the middle has moved. */
export function pinch(prev: { a: number; b: number }, next: { a: number; b: number }): { factor: number; centre: number; move: number } {
  const d0 = Math.abs(prev.b - prev.a), d1 = Math.abs(next.b - next.a);
  const factor = d0 > 4 && d1 > 4 ? d1 / d0 : 1;
  return { factor, centre: (next.a + next.b) / 2, move: (next.a + next.b) / 2 - (prev.a + prev.b) / 2 };
}

/** Seconds per pixel the playhead should auto-pan at while a scrub is held near an edge: 0 inside the middle, rising to a full window a second. */
export function edgeSpeed(x: number, width: number, span: number, zone = 28): number {
  if (!(width > 0)) return 0;
  const left = zone - x, right = x - (width - zone);
  const push = left > 0 ? -Math.min(1, left / zone) : right > 0 ? Math.min(1, right / zone) : 0;
  return push * span;
}

/** A label for the zoom: "1x" is the whole cut, then "2x", "2.5x", "64x"... It is short and fixed in width so the buttons beside it never move. */
export const zoomLabel = (v: View, dur: number) => {
  const z = zoomOf(v, dur);
  return z < 1.05 ? "1x" : z < 10 ? `${z.toFixed(1).replace(/\.0$/, "")}x` : `${Math.round(z)}x`;
};

/** What a zoom key or button does: a step about the playhead (or the middle of the window when the playhead is out of sight), or back to the whole cut. */
export function keyZoom(v: View, what: "in" | "out" | "fit", playhead: number, dur: number): View {
  if (what === "fit") return fullView(dur);
  const anchor = visible(v, playhead) ? playhead : (v.start + v.end) / 2;
  return zoomStep(v, what === "in" ? 1 : -1, anchor, dur);
}
