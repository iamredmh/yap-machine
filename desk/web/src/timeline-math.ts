/** The maths behind the review timeline and its keys. No DOM in here, so it is all unit-tested. */

/** m:ss, or h:mm:ss from an hour up. */
export function clock(t: number): string {
  t = Math.max(0, Number.isFinite(t) ? t : 0);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}
export const clockOf = (t: number, d: number) => `${clock(t)} of ${clock(d)}`;

const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];

/** The smallest "nice" tick spacing (seconds) that keeps labels at least `minGap` px apart. */
export function tickStep(duration: number, width: number, minGap = 76): number {
  if (!(duration > 0) || !(width > 0)) return STEPS[0];
  const need = (minGap / width) * duration;
  return STEPS.find((s) => s >= need) ?? STEPS[STEPS.length - 1];
}

/** Ruler ticks from 0 to the end, each with its position (0..1) and label. */
export function rulerTicks(duration: number, width: number, minGap = 76): { t: number; x: number; label: string }[] {
  if (!(duration > 0)) return [];
  const step = tickStep(duration, width, minGap);
  const out: { t: number; x: number; label: string }[] = [];
  for (let t = 0; t <= duration + 1e-6; t += step) out.push({ t, x: t / duration, label: clock(t) });
  return out;
}

export interface Marker { kind: "note" | "join"; id: string; at: number; seekAt: number; text: string; status?: string; fixedIn?: string; reopened?: number }

/** Notes and flagged joins in one list, in time order. A join plays from a second before the cut so you hear it. */
export function markersFor(
  notes: { id: string; at: number; text: string; status?: string; fixedIn?: string; reopened?: number }[],
  joins: { n: number; at: number; flags: string[] }[],
): Marker[] {
  const list: Marker[] = [
    ...notes.map((n): Marker => ({ kind: "note", id: `note-${n.id}`, at: n.at, seekAt: n.at, text: n.text, status: n.status, fixedIn: n.fixedIn, reopened: n.reopened })),
    ...joins.filter((j) => j.flags.length).map((j): Marker => ({ kind: "join", id: `join-${j.n}`, at: j.at, seekAt: Math.max(0, j.at - 1), text: j.flags[0] })),
  ];
  return list.sort((a, b) => a.seekAt - b.seekAt || (a.kind === b.kind ? 0 : a.kind === "join" ? -1 : 1));
}

/** The marker to jump to from `t`: the next one after it, or the last one before it (a short grace so a press right after a marker goes to the one before). */
export function stepMarker(markers: Marker[], t: number, dir: 1 | -1, grace = 0.4): { marker: Marker; index: number } | null {
  if (dir === 1) {
    const i = markers.findIndex((m) => m.seekAt > t + 0.05);
    return i < 0 ? null : { marker: markers[i], index: i };
  }
  for (let i = markers.length - 1; i >= 0; i--) if (markers[i].seekAt < t - grace) return { marker: markers[i], index: i };
  return null;
}

/** A level below which a stretch of the waveform counts as quiet: a tenth of the loud parts, never under 0.02. */
export function quietThreshold(peaks: ArrayLike<number>): number {
  const sorted = Array.from(peaks).sort((a, b) => a - b);
  if (!sorted.length) return 0.02;
  const loud = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];
  return Math.max(0.02, loud * 0.1);
}

/** Stretches at or above `minSeconds` where every peak is under the threshold, in seconds. */
export function quietRuns(peaks: ArrayLike<number>, duration: number, threshold = quietThreshold(peaks), minSeconds = 0.6): { from: number; to: number }[] {
  const n = peaks.length;
  if (!n || !(duration > 0)) return [];
  const per = duration / n;
  const runs: { from: number; to: number }[] = [];
  let start = -1;
  const close = (end: number) => { if (start >= 0 && (end - start) * per >= minSeconds - 1e-9) runs.push({ from: start * per, to: end * per }); start = -1; };
  for (let i = 0; i < n; i++) { if (peaks[i] < threshold) { if (start < 0) start = i; } else close(i); }
  close(n);
  return runs;
}

/** The frame a time falls in, and the time to seek to so that frame (or the one `by` frames away) is the one on screen. */
export function frameIndex(t: number, fps: number): number { return Math.floor(t * fps + 1e-6); }
export function stepFrames(t: number, fps: number, by: number, duration: number): number {
  const idx = Math.max(0, frameIndex(t, fps) + by);
  const next = (idx + 0.5) / fps;
  return Math.min(Math.max(0, next), Math.max(0, duration - 0.5 / fps));
}

/** Play state driven by J, K, L and Space. `dir` is 0 paused, 1 forward, -1 backward (emulated: browsers can't play backwards). */
export interface Play { dir: -1 | 0 | 1; rate: number }
export const PAUSED: Play = { dir: 0, rate: 1 };
const LADDER = [1, 2, 4];
const faster = (r: number) => LADDER.find((x) => x > r) ?? LADDER[LADDER.length - 1];

/** `base` is the speed the person chose in the control bar: Space plays at it. L and J are shuttle keys and always start at 1x. */
export function press(p: Play, key: "j" | "k" | "l" | "toggle", base = 1): Play {
  if (key === "k") return PAUSED;
  if (key === "toggle") return p.dir === 0 ? { dir: 1, rate: base } : PAUSED;
  const want = key === "l" ? 1 : -1;
  return p.dir === want ? { dir: want, rate: faster(p.rate) } : { dir: want, rate: 1 };
}

/** The speeds the control bar offers. */
export const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
export const SPEED_KEY = "speed";

/** The next speed up or down the list, stopping at the ends. */
export function stepSpeed(current: number, dir: 1 | -1): number {
  const i = SPEEDS.findIndex((x) => x >= current - 1e-9);
  const at = i < 0 ? SPEEDS.length - 1 : i;
  return SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, at + dir))];
}

/** A remembered speed, or 1 if what was stored isn't one of ours. */
export function readSpeed(stored: string | null | undefined): number {
  const n = Number(stored);
  return SPEEDS.includes(n) ? n : 1;
}

export const speedLabel = (x: number) => `${x}x`;

/** A loop range: either end may be unset (the start or the end of the cut stands in). */
export interface LoopRange { in: number | null; out: number | null }
export const NO_RANGE: LoopRange = { in: null, out: null };
const MIN_LOOP = 0.2;

export const hasRange = (r: LoopRange) => r.in !== null || r.out !== null;

/** Set one end at time t. An end that would cross the other one clears the other, so a range is never backwards or empty. */
export function setEdge(r: LoopRange, edge: "in" | "out", t: number, duration: number): LoopRange {
  const x = Math.min(Math.max(0, t), duration);
  if (edge === "in") return { in: x, out: r.out !== null && r.out < x + MIN_LOOP ? null : r.out };
  return { in: r.in !== null && r.in > x - MIN_LOOP ? null : r.in, out: x };
}

/** Where to jump when playback runs off the end of the range (forward) or the start (backward); null when still inside. */
export function loopJump(t: number, r: LoopRange, duration: number, dir: 1 | -1 = 1): number | null {
  const lo = r.in ?? 0, hi = r.out ?? duration;
  if (dir === 1) return t >= hi - 0.02 ? lo : null;
  return t <= lo + 0.02 ? hi : null;
}

export function rangeLabel(r: LoopRange, duration: number): string {
  return `${clock(r.in ?? 0)} to ${clock(r.out ?? duration)}`;
}

export const playLabel = (p: Play) => (p.dir === 0 ? "Paused" : `${p.dir === 1 ? "Forward" : "Back"} ${p.rate}x`);

export type KeyAction =
  | { type: "play"; key: "j" | "k" | "l" | "toggle" }
  | { type: "step"; frames: number }
  | { type: "nudge"; seconds: number }
  | { type: "home" } | { type: "end" } | { type: "mute" } | { type: "fullscreen" } | { type: "note" }
  | { type: "marker"; dir: 1 | -1 } | { type: "help" } | { type: "close" }
  | { type: "zoom"; dir: 1 | -1 } | { type: "zoomFit" }
  | { type: "compare" } | { type: "hear" } | { type: "noteStep"; dir: 1 | -1 } | { type: "speed"; dir: 1 | -1 } | { type: "loop" } | { type: "loopEdge"; edge: "in" | "out" } | { type: "loopClear" };

export interface KeyLike { key: string; shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }

/** What a key press means on the Review screen. A held Ctrl, Cmd or Alt means it isn't ours. */
export function keyAction(e: KeyLike): KeyAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  switch (k) {
    case " ": return { type: "play", key: "toggle" };
    case "k": return { type: "play", key: "k" };
    case "j": return { type: "play", key: "j" };
    case "l": return { type: "play", key: "l" };
    case "ArrowLeft": return { type: "step", frames: e.shiftKey ? -10 : -1 };
    case "ArrowRight": return { type: "step", frames: e.shiftKey ? 10 : 1 };
    case "Home": return { type: "home" };
    case "End": return { type: "end" };
    case "m": return { type: "mute" };
    case "f": return { type: "fullscreen" };
    case "c": return { type: "note" };
    case "[": return { type: "marker", dir: -1 };
    case "]": return { type: "marker", dir: 1 };
    case "?": return { type: "help" };
    case "<": return { type: "speed", dir: -1 };
    case ">": return { type: "speed", dir: 1 };
    case "r": return { type: "loop" };
    case "i": return { type: "loopEdge", edge: "in" };
    case "o": return { type: "loopEdge", edge: "out" };
    case "x": return { type: "loopClear" };
    case "+": case "=": return { type: "zoom", dir: 1 };
    case "-": case "_": return { type: "zoom", dir: -1 };
    case "0": return { type: "zoomFit" };
    case "v": return { type: "compare" };
    case "h": return { type: "hear" };
    case "n": return { type: "noteStep", dir: e.shiftKey ? -1 : 1 };
    case "Escape": return { type: "close" };
    default: return null;
  }
}

/** Keys aren't ours while someone is typing. */
export function isTyping(el: { tagName?: string; isContentEditable?: boolean } | null | undefined): boolean {
  if (!el) return false;
  const tag = (el.tagName ?? "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!el.isContentEditable;
}
