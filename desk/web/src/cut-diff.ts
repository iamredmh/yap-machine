/** Comparing two versions of a cut by what they contain: each segment says which stretch of the raw footage it is. */

export interface CutSeg { t: number; e: number; src: string; ss: number; se: number; text: string; beat: string }

/** Where a moment in one version is in another version, found through the raw footage; null when the other version doesn't have it. */
export function mapTime(from: CutSeg[], t: number, to: CutSeg[]): number | null {
  if (!from.length) return null;
  const s = from.find((x) => t >= x.t && t < x.e) ?? (t >= from[from.length - 1].e ? from[from.length - 1] : undefined);
  if (!s || !(s.e > s.t) || !s.src) return null;
  const at = Math.min(t, s.e - 1e-6);
  const source = s.ss + ((at - s.t) * (s.se - s.ss)) / (s.e - s.t);
  for (const u of to) {
    if (u.src === s.src && source >= u.ss - 1e-6 && source < u.se && u.e > u.t) return u.t + ((source - u.ss) * (u.e - u.t)) / (u.se - u.ss);
  }
  return null;
}

type Span = [number, number];

/** The stretches of each raw source a cut uses, merged. */
function coverage(segs: CutSeg[]): Map<string, Span[]> {
  const by = new Map<string, Span[]>();
  for (const s of segs) if (s.src && s.se > s.ss) (by.get(s.src) ?? by.set(s.src, []).get(s.src)!).push([s.ss, s.se]);
  for (const [k, list] of by) {
    list.sort((a, b) => a[0] - b[0]);
    const out: Span[] = [];
    for (const [a, b] of list) { const last = out[out.length - 1]; if (last && a <= last[1] + 1e-6) last[1] = Math.max(last[1], b); else out.push([a, b]); }
    by.set(k, out);
  }
  return by;
}

export interface Piece {
  /** Where it sits in the version it belongs to. */
  from: number; to: number;
  src: string; srcFrom: number; srcTo: number;
  text: string; beat: string;
  /** Only part of the segment is new (or gone). */
  partial: boolean;
}

/** The parts of `segs` that the other cut doesn't use. */
function missingFrom(segs: CutSeg[], other: Map<string, Span[]>): Piece[] {
  const out: Piece[] = [];
  for (const s of segs) {
    if (!s.src || !(s.se > s.ss) || !(s.e > s.t)) continue;
    const ratio = (s.e - s.t) / (s.se - s.ss);
    let left: Span[] = [[s.ss, s.se]];
    for (const [a, b] of other.get(s.src) ?? []) {
      left = left.flatMap(([x, y]): Span[] => (b <= x || a >= y ? [[x, y]] : [...(a > x ? [[x, a] as Span] : []), ...(b < y ? [[b, y] as Span] : [])]));
    }
    for (const [x, y] of left) {
      if (y - x < 0.02) continue;
      out.push({ from: s.t + (x - s.ss) * ratio, to: s.t + (y - s.ss) * ratio, src: s.src, srcFrom: x, srcTo: y, text: s.text, beat: s.beat, partial: y - x < s.se - s.ss - 0.02 });
    }
  }
  return out;
}

/** Neighbouring pieces that run on from each other (the same raw stretch, the same place in the cut) are one change. */
function join(pieces: Piece[]): Piece[] {
  const out: Piece[] = [];
  for (const p of pieces) {
    const last = out[out.length - 1];
    if (last && last.src === p.src && Math.abs(last.srcTo - p.srcFrom) < 0.03 && Math.abs(last.to - p.from) < 0.03) {
      last.to = p.to; last.srcTo = p.srcTo; last.partial = last.partial || p.partial;
      if (!last.text.includes(p.text)) last.text = `${last.text} ${p.text}`;
    } else out.push({ ...p });
  }
  return out;
}

/** Changes shorter than this are listed as small trims (a cut edge moved), not as added or removed lines. */
export const SMALL_CHANGE = 0.5;

export interface CutDiff {
  added: Piece[];     // in B, not in A (times are B's)
  removed: Piece[];   // in A, not in B (times are A's)
  trimsAdded: Piece[];
  trimsRemoved: Piece[];
  addedSeconds: number;
  removedSeconds: number;
}

export function diffCuts(a: CutSeg[], b: CutSeg[]): CutDiff {
  const added = join(missingFrom(b, coverage(a)));
  const removed = join(missingFrom(a, coverage(b)));
  const big = (p: Piece) => p.to - p.from >= SMALL_CHANGE;
  const sum = (l: Piece[]) => l.reduce((n, p) => n + (p.to - p.from), 0);
  return { added: added.filter(big), removed: removed.filter(big), trimsAdded: added.filter((p) => !big(p)), trimsRemoved: removed.filter((p) => !big(p)), addedSeconds: sum(added), removedSeconds: sum(removed) };
}

/**
 * The stretch of version A to show beside a zoomed stretch of version B, so the two stay on the same words.
 * Each end is found through the raw footage; an end that falls where A has nothing (B added it) takes the nearest A moment before it
 * (or after it, at the start of the cut). A stretch of B that is all new gives a window of one second at that spot.
 */
export function viewInA(b: CutSeg[], a: CutSeg[], view: { start: number; end: number }, durA: number): { start: number; end: number } {
  const probe = (t: number, dir: 1 | -1): number | null => {
    const direct = mapTime(b, t, a);
    if (direct !== null) return direct;
    // walk through B's segments towards the other side until one has a counterpart in A
    const order = dir === -1 ? b.filter((s) => s.e <= t).reverse() : b.filter((s) => s.t >= t);
    for (const s of order) {
      const m = mapTime(b, dir === -1 ? s.e - 1e-3 : s.t + 1e-3, a);
      if (m !== null) return m;
    }
    return null;
  };
  const s = probe(view.start, 1) ?? durA;
  const e = probe(view.end - 1e-3, -1) ?? 0;
  const start = Math.max(0, Math.min(s, Math.max(0, durA - 1))), end = Math.min(durA, e > start ? e : start + 1);
  return { start, end: Math.max(end, Math.min(durA, start + 1)) };
}

/** What happened to a note made on version A, as seen in version B. */
export function noteNow(aSegs: CutSeg[], bSegs: CutSeg[], at: number): { at: number } | { cut: true } {
  const t = mapTime(aSegs, at, bSegs);
  return t === null ? { cut: true } : { at: t };
}

export const changeCount = (d: CutDiff) => d.added.length + d.removed.length;
