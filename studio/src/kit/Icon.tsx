import React, { useMemo } from 'react';
import { useCurrentFrame } from 'remotion';
import { rgba } from '../engine/colour';
import { SIG } from '../engine/signature';
import type { Signature } from '../engine/pack';
import { roughEllipse, roughLine, roughPoly, roughRect } from './rough';

// One icon set, drawn the signature's way. Each icon is a few shapes on a 24-unit grid (lines, polylines, circles,
// boxes), so the same icon comes out as lines, duotone, solid, hand-drawn, pixels (rasterised from the shapes) or a
// sticker. Icons whose first shape holds the rest (a clock face, a coin) cut their details out of it when solid.

type Pt = [number, number];
type Shape =
  | { t: 'line'; a: [number, number, number, number] }
  | { t: 'poly'; p: Pt[]; closed?: boolean }
  | { t: 'circle'; c: Pt; r: number }
  | { t: 'rect'; x: number; y: number; w: number; h: number; r?: number };

const arc = (cx: number, cy: number, r: number, a0: number, a1: number, n = 18): Pt[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    return [+(cx + Math.cos(a) * r).toFixed(2), +(cy + Math.sin(a) * r).toFixed(2)];
  });

const star = (cx: number, cy: number, ro: number, ri: number, n = 5): Pt[] =>
  Array.from({ length: n * 2 }, (_, i) => {
    const a = (Math.PI * i) / n - Math.PI / 2;
    const r = i % 2 ? ri : ro;
    return [+(cx + Math.cos(a) * r).toFixed(2), +(cy + Math.sin(a) * r).toFixed(2)];
  });

const heart = (): Pt[] =>
  Array.from({ length: 40 }, (_, i) => {
    const t = (i / 40) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    return [+(12 + x * 0.56).toFixed(2), +(12.4 - y * 0.56).toFixed(2)];
  });

const eye = (): Pt[] => [
  ...Array.from({ length: 13 }, (_, i): Pt => [+(2.5 + (19 * i) / 12).toFixed(2), +(12 - 6.6 * Math.sin((Math.PI * i) / 12)).toFixed(2)]),
  ...Array.from({ length: 11 }, (_, i): Pt => [+(21.5 - (19 * (i + 1)) / 12).toFixed(2), +(12 + 6.6 * Math.sin((Math.PI * (i + 1)) / 12)).toFixed(2)]),
];

/** The icons, by name; `base`: the first shape holds the rest, which a solid icon cuts out of it. */
export const ICONS: Record<string, { shapes: Shape[]; base?: boolean }> = {
  bolt: { shapes: [{ t: 'poly', p: [[13, 2], [4, 13.5], [11, 13.5], [10, 22], [20, 9.5], [13, 9.5]], closed: true }] },
  clock: { base: true, shapes: [{ t: 'circle', c: [12, 12], r: 9 }, { t: 'line', a: [12, 7, 12, 12] }, { t: 'line', a: [12, 12, 15.5, 14] }] },
  coin: {
    base: true,
    shapes: [
      { t: 'circle', c: [12, 12], r: 9 },
      { t: 'poly', p: [[15, 8.6], [10.6, 8.6], [9.4, 9.7], [9.4, 10.9], [10.6, 12], [13.4, 12], [14.6, 13.1], [14.6, 14.3], [13.4, 15.4], [9, 15.4]] },
      { t: 'line', a: [12, 6.6, 12, 8.6] },
      { t: 'line', a: [12, 15.4, 12, 17.4] },
    ],
  },
  chart: {
    shapes: [
      { t: 'rect', x: 5, y: 12, w: 3.6, h: 8.5, r: 1 },
      { t: 'rect', x: 10.2, y: 6, w: 3.6, h: 14.5, r: 1 },
      { t: 'rect', x: 15.4, y: 9.5, w: 3.6, h: 11, r: 1 },
      { t: 'line', a: [3, 20.5, 21, 20.5] },
    ],
  },
  trend: { shapes: [{ t: 'poly', p: [[3, 17], [9, 11], [13, 14.5], [21, 6.5]] }, { t: 'poly', p: [[15.5, 6.5], [21, 6.5], [21, 12]] }] },
  spark: {
    shapes: [
      { t: 'poly', p: [[11, 3], [12.9, 10.1], [20, 12], [12.9, 13.9], [11, 21], [9.1, 13.9], [2, 12], [9.1, 10.1]], closed: true },
      { t: 'poly', p: [[19, 2], [19.7, 4.3], [22, 5], [19.7, 5.7], [19, 8], [18.3, 5.7], [16, 5], [18.3, 4.3]], closed: true },
    ],
  },
  check: { base: true, shapes: [{ t: 'circle', c: [12, 12], r: 9 }, { t: 'poly', p: [[7.8, 12.4], [10.8, 15.4], [16.4, 9]] }] },
  chat: { shapes: [{ t: 'rect', x: 3, y: 4, w: 18, h: 13, r: 3 }, { t: 'poly', p: [[8, 16.5], [6.5, 21], [13, 16.5]], closed: true }] },
  code: { shapes: [{ t: 'poly', p: [[8, 7], [3, 12], [8, 17]] }, { t: 'poly', p: [[16, 7], [21, 12], [16, 17]] }, { t: 'line', a: [13.8, 4.8, 10.2, 19.2] }] },
  star: { shapes: [{ t: 'poly', p: star(12, 12.6, 9.6, 4.2), closed: true }] },
  heart: { shapes: [{ t: 'poly', p: heart(), closed: true }] },
  gauge: { shapes: [{ t: 'poly', p: arc(12, 15, 9, 180, 360) }, { t: 'line', a: [12, 15, 16.4, 9.6] }, { t: 'circle', c: [12, 15], r: 1.7 }] },
  eye: { base: true, shapes: [{ t: 'poly', p: eye(), closed: true }, { t: 'circle', c: [12, 12], r: 3.2 }] },
  target: { base: true, shapes: [{ t: 'circle', c: [12, 12], r: 9 }, { t: 'circle', c: [12, 12], r: 5 }, { t: 'circle', c: [12, 12], r: 1.4 }] },
  layers: { shapes: [{ t: 'poly', p: [[12, 3], [21, 8], [12, 13], [3, 8]], closed: true }, { t: 'poly', p: [[3, 12.5], [12, 17.5], [21, 12.5]] }, { t: 'poly', p: [[3, 17], [12, 22], [21, 17]] }] },
  play: { base: true, shapes: [{ t: 'circle', c: [12, 12], r: 9 }, { t: 'poly', p: [[10, 8], [16.5, 12], [10, 16]], closed: true }] },
  user: { shapes: [{ t: 'circle', c: [12, 8], r: 4 }, { t: 'poly', p: arc(12, 21, 7.5, 180, 360), closed: true }] },
  mail: { base: true, shapes: [{ t: 'rect', x: 3, y: 5.5, w: 18, h: 13, r: 2 }, { t: 'poly', p: [[3.6, 7], [12, 13], [20.4, 7]] }] },
  lock: { shapes: [{ t: 'rect', x: 5, y: 11, w: 14, h: 10, r: 2 }, { t: 'poly', p: [[8, 11], ...arc(12, 8, 4, 180, 360, 12), [16, 11]] }] },
};

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

const closed = (s: Shape) => s.t === 'circle' || s.t === 'rect' || (s.t === 'poly' && !!s.closed);

const svgShape = (s: Shape, key: React.Key, props: React.SVGProps<SVGElement>) => {
  if (s.t === 'line') return <line key={key} x1={s.a[0]} y1={s.a[1]} x2={s.a[2]} y2={s.a[3]} {...(props as React.SVGProps<SVGLineElement>)} />;
  if (s.t === 'circle') return <circle key={key} cx={s.c[0]} cy={s.c[1]} r={s.r} {...(props as React.SVGProps<SVGCircleElement>)} />;
  if (s.t === 'rect') return <rect key={key} x={s.x} y={s.y} width={s.w} height={s.h} rx={s.r ?? 0} {...(props as React.SVGProps<SVGRectElement>)} />;
  const d = `M${s.p.map((p) => p.join(' ')).join(' L')}${s.closed ? ' Z' : ''}`;
  return <path key={key} d={d} {...(props as React.SVGProps<SVGPathElement>)} />;
};

const roughShape = (s: Shape, seed: number, rough: number) => {
  if (s.t === 'line') return roughLine(s.a[0], s.a[1], s.a[2], s.a[3], rough, seed);
  if (s.t === 'circle') return roughEllipse(s.c[0], s.c[1], s.r, s.r, rough, seed, 1.06);
  if (s.t === 'rect') return roughRect(s.x, s.y, s.w, s.h, rough, seed);
  return roughPoly(s.p, !!s.closed, rough, seed);
};

/** The icon's line drawing rasterised to a pixel grid: a canvas draws it small, every pixel past half coverage stays. */
const pixels = (name: string, grid: number): boolean[] => {
  const cv = document.createElement('canvas');
  cv.width = grid;
  cv.height = grid;
  const g = cv.getContext('2d')!;
  g.scale(grid / 24, grid / 24);
  g.strokeStyle = '#000';
  g.fillStyle = '#000';
  g.lineWidth = 2.4;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const s of ICONS[name].shapes) {
    g.beginPath();
    if (s.t === 'line') {
      g.moveTo(s.a[0], s.a[1]);
      g.lineTo(s.a[2], s.a[3]);
    } else if (s.t === 'circle') g.arc(s.c[0], s.c[1], s.r, 0, Math.PI * 2);
    else if (s.t === 'rect') g.rect(s.x, s.y, s.w, s.h);
    else {
      s.p.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
      if (s.closed) g.closePath();
    }
    g.stroke();
  }
  const data = g.getImageData(0, 0, grid, grid).data;
  return Array.from({ length: grid * grid }, (_, i) => data[i * 4 + 3] > 110);
};

type ArtProps = {
  name: string;
  size: number;
  colour: string;
  hero: string;
  knock: string;
  kind: Signature['icons'];
  /** The frame, and the hand-drawn wobble and boil (frames per drawing), for sketch icons. */
  frame?: number;
  rough?: number;
  boil?: number;
  style?: React.CSSProperties;
};

/**
 * An icon at `size` px in `colour`, drawn as `kind`, with no engine around it (the web app draws its pickers with it).
 * `hero` fills duotone shapes and shades pixel icons; `knock` is the colour details are cut out in on solid and sticker
 * icons (the card or ground behind).
 */
export const IconArt: React.FC<ArtProps> = ({ name, size, colour, hero, knock, kind, frame = 0, rough: wobble = 0, boil = 0, style }) => {
  const f = frame;
  // its own names only: "constructor" is in every object
  const known = Object.hasOwn(ICONS, name);
  const icon = known ? ICONS[name] : ICONS.spark;
  const grid = 16;
  const px = useMemo(() => (kind === 'pixel' ? pixels(known ? name : 'spark', grid) : null), [kind, name, known]);
  if (kind === 'none') return null;
  const box: React.CSSProperties = { width: size, height: size, display: 'block', overflow: 'visible', ...style };
  const line = { fill: 'none', stroke: colour, strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

  if (kind === 'pixel' && px) {
    const on = (x: number, y: number) => x >= 0 && y >= 0 && x < grid && y < grid && px[y * grid + x];
    const cells: React.ReactNode[] = [];
    for (let y = 0; y < grid; y++)
      for (let x = 0; x < grid; x++) {
        if (on(x, y)) cells.push(<rect key={`p${x}-${y}`} x={x} y={y} width={1.02} height={1.02} fill={colour} />);
        else if (on(x - 1, y - 1)) cells.push(<rect key={`s${x}-${y}`} x={x} y={y} width={1.02} height={1.02} fill={rgba(hero, 0.55)} />);
      }
    return (
      <svg viewBox={`0 0 ${grid} ${grid}`} style={{ ...box, imageRendering: 'pixelated' }} shapeRendering="crispEdges">
        {cells}
      </svg>
    );
  }

  if (kind === 'sketch') {
    const seed = name.length * 97 + (boil > 0 ? Math.floor(f / boil) * 7919 : 0);
    const rough = Math.max(0.5, wobble * 0.28);
    return (
      <svg viewBox="0 0 24 24" style={box}>
        {icon.shapes.map((s, i) => closed(s) && <path key={`h${i}`} d={roughShape(s, seed + i * 31 + 5, rough * 1.4)} fill="none" stroke={rgba(hero, 0.5)} strokeWidth={3.4} strokeLinecap="round" transform="translate(0.8 0.9)" />)}
        {icon.shapes.map((s, i) => <path key={i} d={roughShape(s, seed + i * 31, rough)} {...line} strokeWidth={1.5} />)}
      </svg>
    );
  }

  if (kind === 'line' || kind === 'duotone') {
    return (
      <svg viewBox="0 0 24 24" style={box}>
        {kind === 'duotone' && icon.shapes.map((s, i) => closed(s) && svgShape(s, `d${i}`, { fill: rgba(hero, 0.32), stroke: 'none', transform: 'translate(1.2 1.2)' }))}
        {icon.shapes.map((s, i) => svgShape(s, i, line))}
      </svg>
    );
  }

  // solid and sticker: closed shapes filled, open ones stroked; on a base icon the rest is cut out of the first shape
  const solid = (fill: string, cut: string) =>
    icon.shapes.map((s, i) => {
      const inBase = icon.base && i > 0;
      const c = inBase ? cut : fill;
      return closed(s) ? svgShape(s, i, { fill: c, stroke: c, strokeWidth: inBase ? 0 : 1.2, strokeLinejoin: 'round' }) : svgShape(s, i, { fill: 'none', stroke: c, strokeWidth: 2.4, strokeLinecap: 'round', strokeLinejoin: 'round' });
    });
  if (kind === 'sticker') {
    return (
      <svg viewBox="0 0 24 24" style={{ ...box, filter: 'drop-shadow(0 2px 0 rgba(0,0,0,0.35))' }}>
        <g>{icon.shapes.map((s, i) => (closed(s) ? svgShape(s, `o${i}`, { fill: '#FFFFFF', stroke: '#FFFFFF', strokeWidth: 5, strokeLinejoin: 'round' }) : svgShape(s, `o${i}`, { fill: 'none', stroke: '#FFFFFF', strokeWidth: 7, strokeLinecap: 'round', strokeLinejoin: 'round' })))}</g>
        {solid(colour, '#FFFFFF')}
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" style={box}>
      {solid(colour, knock)}
    </svg>
  );
};

/** An icon drawn the pack's way (or `kind`), on the render's frame: hand-drawn icons boil as the signature says. */
export const Icon: React.FC<Omit<ArtProps, 'kind' | 'frame' | 'rough' | 'boil'> & { kind?: Signature['icons'] }> = ({ kind = SIG.icons, ...rest }) => {
  const frame = useCurrentFrame();
  return <IconArt {...rest} kind={kind} frame={frame} rough={SIG.rough} boil={SIG.boil} />;
};
