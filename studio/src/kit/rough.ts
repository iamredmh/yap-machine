// Hand-drawn strokes as SVG paths: each line drawn twice with a little wobble, the way a pen goes over a mark, from a
// seed so a drawing is the same on every render of a frame (and changes only when the seed does: the signature's boil).

/** A small seeded random generator (mulberry32): the same seed, the same strokes. */
export const rng = (seed: number) => {
  let a = seed >>> 0 || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

type R = () => number;
const off = (r: R, amount: number) => (r() * 2 - 1) * amount;
const f1 = (x: number) => x.toFixed(1);

/** One pass of a wobbly line: a gentle curve through a jittered midpoint, ends overshooting a touch. */
const pass = (r: R, x1: number, y1: number, x2: number, y2: number, rough: number) => {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const j = Math.min(rough, len / 10 + rough * 0.3);
  const mx = (x1 + x2) / 2 + off(r, j * 1.4);
  const my = (y1 + y2) / 2 + off(r, j * 1.4);
  return `M${f1(x1 + off(r, j))} ${f1(y1 + off(r, j))} Q${f1(mx)} ${f1(my)} ${f1(x2 + off(r, j))} ${f1(y2 + off(r, j))}`;
};

/** A hand-drawn line, gone over twice. */
export const roughLine = (x1: number, y1: number, x2: number, y2: number, rough: number, seed: number) => {
  const r = rng(seed);
  return `${pass(r, x1, y1, x2, y2, rough)} ${pass(r, x1, y1, x2, y2, rough * 0.8)}`;
};

/** A hand-drawn polyline (closed or open), each segment gone over twice. */
export const roughPoly = (pts: Array<[number, number]>, closed: boolean, rough: number, seed: number) => {
  const r = rng(seed);
  const segs = closed ? pts.map((p, i) => [p, pts[(i + 1) % pts.length]] as const) : pts.slice(1).map((p, i) => [pts[i], p] as const);
  return segs.map(([a, b]) => `${pass(r, a[0], a[1], b[0], b[1], rough)} ${pass(r, a[0], a[1], b[0], b[1], rough * 0.8)}`).join(' ');
};

/** A hand-drawn box: four lines that cross a little at the corners. */
export const roughRect = (x: number, y: number, w: number, h: number, rough: number, seed: number) => {
  const r = rng(seed);
  const o = rough * 1.2;
  const lines: Array<[number, number, number, number]> = [
    [x - o, y, x + w + o, y],
    [x + w, y - o, x + w, y + h + o],
    [x + w + o, y + h, x - o, y + h],
    [x, y + h + o, x, y - o],
  ];
  return lines.map(([a, b, c, d]) => `${pass(r, a, b, c, d, rough)} ${pass(r, a, b, c, d, rough * 0.75)}`).join(' ');
};

/** A scribbled ellipse: a little over one turn, its radius wandering, so the ends cross like a quick circle round a word. */
export const roughEllipse = (cx: number, cy: number, rx: number, ry: number, rough: number, seed: number, turns = 1.12) => {
  const r = rng(seed);
  const n = 36;
  const start = r() * Math.PI * 2;
  const pts: string[] = [];
  const wander = rough / Math.max(rx, ry);
  let drift = 0;
  for (let i = 0; i <= n * turns; i++) {
    const t = start + (i / n) * Math.PI * 2;
    drift += off(r, wander * 0.6);
    drift *= 0.92;
    const k = 1 + drift + off(r, wander * 0.25) + (i / (n * turns)) * wander * 1.5;
    pts.push(`${f1(cx + Math.cos(t) * rx * k)} ${f1(cy + Math.sin(t) * ry * k)}`);
  }
  return `M${pts[0]} L${pts.slice(1).join(' L')}`;
};

/** A torn paper edge along y over [0, w]: a jagged line with small random steps. Returns polygon points, top edge only. */
export const tornEdge = (w: number, y: number, depth: number, seed: number) => {
  const r = rng(seed);
  const pts: Array<[number, number]> = [];
  let x = 0;
  while (x < w) {
    pts.push([x, y + r() * depth]);
    x += 8 + r() * 18;
  }
  pts.push([w, y + r() * depth]);
  return pts;
};
