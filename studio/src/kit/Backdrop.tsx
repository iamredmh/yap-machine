import React from 'react';
import { rgba } from '../engine/colour';
import type { Backdrop } from '../engine/pack';

// The backdrops a pack can draw on its ground (src/engine/pack.ts, `backdrops`), all in code. Pure on purpose: it takes
// colours and the frame rather than reading the pack, so the Ground draws it in a render and the web app draws the
// same thing on its picker. Motion is slow and loops, so a still and a render agree on what a backdrop is.

export type BackdropColours = {
  /** Lines and dots: the ground's type colour (text on dark, ink on light). */
  line: string;
  /** Glows. */
  hero: string;
  /** Aurora fields, resolved from the backdrop's colour names. */
  fields: string[];
};

/** `scale` shrinks the backdrop's own px sizes (cells, ticks, blur) for a small preview; line widths stay as they are. */
type Props = { spec: Backdrop; theme: 'dark' | 'light'; colours: BackdropColours; frame: number; fps?: number; width: number; height: number; scale?: number };

const fill: React.CSSProperties = { position: 'absolute', inset: 0 };

/** Static fine grain (an SVG noise tile): per-frame noise would boil. */
const GRAIN = `url("data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>",
)}")`;

const Grain: React.FC<{ amount: number; theme: 'dark' | 'light'; scale?: number }> = ({ amount, theme, scale = 1 }) =>
  amount > 0 ? <div style={{ ...fill, backgroundImage: GRAIN, backgroundSize: `${220 * scale}px ${220 * scale}px`, opacity: amount * (theme === 'dark' ? 0.55 : 0.35), mixBlendMode: theme === 'dark' ? 'screen' : 'multiply' }} /> : null;

/** A soft glow in the hero colour, centred at x, y (% of the frame). */
const Glow: React.FC<{ hero: string; amount: number; theme: 'dark' | 'light'; x?: number; y?: number; w?: number; h?: number }> = ({ hero, amount, theme, x = 50, y = 38, w = 75, h = 42 }) =>
  amount > 0 ? (
    <div style={{ ...fill, background: `radial-gradient(ellipse ${w}% ${h}% at ${x}% ${y}%, ${rgba(hero, theme === 'dark' ? amount : amount * 0.6)}, transparent 70%)`, mixBlendMode: theme === 'dark' ? 'screen' : 'multiply' }} />
  ) : null;

const edgeFade = (fade: number, w = 110, h = 80) => (fade > 0 ? `radial-gradient(${w}% ${h}% at 50% 45%, #000 ${Math.round(100 - 55 * fade)}%, transparent 100%)` : undefined);

export const BackdropLayer: React.FC<Props> = ({ spec: raw, theme, colours, frame, fps = 30, width, height, scale = 1 }) => {
  const t = frame / fps;
  const spec = 'size' in raw ? { ...raw, size: raw.size * scale } : raw;
  const { line, hero } = colours;

  if (spec.kind === 'grid') {
    const l = rgba(line, spec.alpha);
    const mask = edgeFade(spec.fade);
    return (
      <>
        <div
          style={{
            ...fill,
            backgroundImage: `linear-gradient(${l} 1.5px, transparent 1.5px), linear-gradient(90deg, ${l} 1.5px, transparent 1.5px)`,
            backgroundSize: `${spec.size}px ${spec.size}px`,
            backgroundPosition: 'center center',
            WebkitMaskImage: mask,
            maskImage: mask,
          }}
        />
        <Glow hero={hero} amount={spec.glow} theme={theme} />
        <Grain amount={spec.grain} theme={theme} scale={scale} />
      </>
    );
  }

  if (spec.kind === 'dots') {
    const mask = edgeFade(spec.fade, 85, 62);
    const tick = rgba(line, Math.min(0.75, spec.alpha * 2.4));
    const corners: Array<[number, number, 1 | -1, 1 | -1]> = [[5.5, 10.5, 1, 1], [94.5, 10.5, -1, 1], [5.5, 89.5, 1, -1], [94.5, 89.5, -1, -1]];
    return (
      <>
        {/* an SVG pattern, not a CSS gradient: gradient dots are rasterised at the tile's size and vanish when the frame is
            shown small (a preview, a phone); circles stay round and visible */}
        <svg width={width} height={height} style={{ position: 'absolute', inset: 0, WebkitMaskImage: mask, maskImage: mask }}>
          <defs>
            <pattern id={`dots${Math.round(spec.size * 10)}`} width={spec.size} height={spec.size} patternUnits="userSpaceOnUse" x={(width / 2) % spec.size} y={(height / 2) % spec.size}>
              <circle cx={spec.size / 2} cy={spec.size / 2} r={2.6} fill={line} fillOpacity={spec.alpha} />
            </pattern>
          </defs>
          <rect width={width} height={height} fill={`url(#dots${Math.round(spec.size * 10)})`} />
        </svg>
        {spec.ticks &&
          corners.map(([x, y, sx, sy], i) => (
            <div
              key={i}
              style={{
                position: 'absolute', width: 40 * scale, height: 40 * scale,
                left: `calc(${x}% - ${sx > 0 ? 0 : 40 * scale}px)`, top: `calc(${y}% - ${sy > 0 ? 0 : 40 * scale}px)`,
                [sx > 0 ? 'borderLeft' : 'borderRight']: `3px solid ${tick}`,
                [sy > 0 ? 'borderTop' : 'borderBottom']: `3px solid ${tick}`,
              }}
            />
          ))}
        <Glow hero={hero} amount={spec.glow} theme={theme} />
        <Grain amount={spec.grain} theme={theme} scale={scale} />
      </>
    );
  }

  if (spec.kind === 'horizon') {
    // a floor grid seen in perspective: rays from the vanishing point, and cross lines at depth z drawn at
    // horizon + depth * near / z, so the first cell is about `size` tall; the lines drift toward the viewer and loop
    const hy = height * spec.horizon;
    const depth = height - hy;
    const near = Math.max(1, depth / spec.size - 1);
    const phase = (((t * spec.speed) % 1) + 1) % 1;
    const cross: number[] = [];
    for (let j = 0; j < 400; j++) {
      const z = near + j - phase;
      const y = hy + (depth * near) / z;
      if (y > height + 2) continue;
      if (y - hy < 3) break;
      cross.push(y);
    }
    const rays: number[] = [];
    for (let k = -60; k <= 60; k++) rays.push(width / 2 + k * spec.size);
    const id = `hz${Math.round(spec.horizon * 1000)}${Math.round(spec.size)}`;
    return (
      <>
        <svg width={width} height={height} style={{ position: 'absolute', inset: 0 }}>
          <defs>
            <linearGradient id={`${id}f`} x1="0" y1={hy} x2="0" y2={hy + depth * 0.5} gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#fff" stopOpacity="0" />
              <stop offset="1" stopColor="#fff" stopOpacity="1" />
            </linearGradient>
            <mask id={`${id}m`}>
              <rect x="0" y={hy} width={width} height={depth} fill={`url(#${id}f)`} />
            </mask>
          </defs>
          <g mask={`url(#${id}m)`} stroke={line} strokeOpacity={spec.alpha} strokeWidth={2.5}>
            {rays.map((x, i) => <line key={`r${i}`} x1={width / 2} y1={hy} x2={width / 2 + (x - width / 2) * 3} y2={hy + depth * 3} />)}
            {cross.map((y, i) => <line key={`c${i}`} x1={0} y1={y} x2={width} y2={y} />)}
          </g>
        </svg>
        <Glow hero={hero} amount={spec.glow} theme={theme} y={(hy / height) * 100} w={90} h={16} />
        <Glow hero={hero} amount={spec.glow * 0.5} theme={theme} y={(hy / height) * 100 - 14} w={70} h={30} />
      </>
    );
  }

  if (spec.kind === 'aurora') {
    const fields = colours.fields.length ? colours.fields : [hero];
    const a = theme === 'dark' ? spec.alpha : spec.alpha * 0.55;
    const base: Array<[number, number]> = [[26, 22], [76, 44], [40, 74]];
    const layers = fields.slice(0, 3).map((c, i) => {
      const x = base[i][0] + Math.sin(t * spec.speed + i * 2.1) * 9;
      const y = base[i][1] + Math.cos(t * spec.speed * 0.8 + i * 1.3) * 6;
      return `radial-gradient(ellipse 62% 34% at ${x.toFixed(2)}% ${y.toFixed(2)}%, ${rgba(c, a)}, transparent 70%)`;
    });
    return (
      <>
        <div style={{ ...fill, background: layers.join(', '), mixBlendMode: theme === 'dark' ? 'screen' : 'multiply' }} />
        <Grain amount={spec.grain} theme={theme} scale={scale} />
      </>
    );
  }

  if (spec.kind === 'spotlight') {
    const sway = Math.sin(t * 0.35) * spec.sway;
    const light = theme === 'dark' ? line : '#FFFFFF';
    const a = spec.alpha;
    return (
      <>
        {theme === 'light' && <div style={{ ...fill, background: `radial-gradient(ellipse 80% 70% at 50% 40%, transparent 35%, ${rgba(line, a * 0.9)} 100%)` }} />}
        <div style={{ ...fill, transformOrigin: '50% -8%', transform: `rotate(${sway.toFixed(3)}deg)` }}>
          <div
            style={{
              position: 'absolute', left: '-20%', right: '-20%', top: '-8%', height: '104%',
              background: `linear-gradient(to bottom, ${rgba(light, a * 1.7)} 0%, ${rgba(light, a * 0.55)} 55%, transparent 92%)`,
              clipPath: 'polygon(46% 0, 54% 0, 80% 100%, 20% 100%)',
              filter: `blur(${26 * scale}px)`,
            }}
          />
        </div>
        <div style={{ ...fill, background: `radial-gradient(ellipse 30% 9% at 50% 0%, ${rgba(light, a * 2.2)}, transparent 70%), radial-gradient(ellipse 40% 5% at 50% 86%, ${rgba(light, a * 1.4)}, transparent 70%)` }} />
      </>
    );
  }

  if (spec.kind === 'rings') {
    const cy = height * 0.42;
    const maxR = Math.hypot(width, height) * 0.62;
    const phase = (((t * spec.speed) % 1) + 1) % 1;
    const rings: Array<{ r: number; o: number }> = [];
    for (let i = 0; i < 200; i++) {
      const r = (i + phase) * spec.size;
      if (r > maxR) break;
      rings.push({ r, o: spec.alpha * (1 - r / maxR) ** 0.7 });
    }
    return (
      <>
        <svg width={width} height={height} style={{ position: 'absolute', inset: 0 }}>
          {rings.map((g, i) => <circle key={i} cx={width / 2} cy={cy} r={g.r} fill="none" stroke={line} strokeOpacity={g.o} strokeWidth={3} />)}
        </svg>
        <Glow hero={hero} amount={spec.glow} theme={theme} y={42} w={55} h={32} />
      </>
    );
  }

  if (spec.kind === 'paper') {
    // a sheet of paper: its lines in the ground's type colour, a red margin line, grain, edges a touch darker
    const l = rgba(line, spec.alpha);
    const sz = spec.size;
    const lines =
      spec.lines === 'grid'
        ? { backgroundImage: `linear-gradient(${l} 1.5px, transparent 1.5px), linear-gradient(90deg, ${l} 1.5px, transparent 1.5px)`, backgroundSize: `${sz}px ${sz}px` }
        : spec.lines === 'ruled'
          ? { backgroundImage: `linear-gradient(${l} 2px, transparent 2px)`, backgroundSize: `100% ${sz}px` }
          : null;
    return (
      <>
        {lines && <div style={{ ...fill, ...lines, backgroundPosition: '0 0' }} />}
        {spec.lines === 'dots' && (
          <svg width={width} height={height} style={{ position: 'absolute', inset: 0 }}>
            <defs>
              <pattern id={`pp${Math.round(sz * 10)}`} width={sz} height={sz} patternUnits="userSpaceOnUse">
                <circle cx={sz / 2} cy={sz / 2} r={2.6} fill={line} fillOpacity={spec.alpha * 1.6} />
              </pattern>
            </defs>
            <rect width={width} height={height} fill={`url(#pp${Math.round(sz * 10)})`} />
          </svg>
        )}
        {spec.margin && <div style={{ position: 'absolute', top: 0, bottom: 0, left: 120 * scale, width: 3, background: rgba('#E5484D', 0.45) }} />}
        <div style={{ ...fill, background: `radial-gradient(ellipse 85% 70% at 50% 45%, transparent 60%, ${rgba(theme === 'dark' ? '#000000' : '#8A6D3B', theme === 'dark' ? 0.4 : 0.12)} 100%)` }} />
        <Grain amount={spec.grain} theme={theme} scale={scale} />
      </>
    );
  }

  if (spec.kind === 'scanlines') {
    // a CRT: scan lines, a phosphor glow from the middle, and a soft bright band rolling down every few seconds
    const roll = spec.roll > 0 ? (((t * spec.roll) % 1) + 1) % 1 : -1;
    return (
      <>
        <Glow hero={hero} amount={spec.glow} theme={theme} y={45} w={95} h={70} />
        <div style={{ ...fill, backgroundImage: `repeating-linear-gradient(to bottom, ${rgba('#000000', spec.alpha * 3.5)} 0, ${rgba('#000000', spec.alpha * 3.5)} ${(spec.size / 2).toFixed(1)}px, transparent ${(spec.size / 2).toFixed(1)}px, transparent ${spec.size}px)` }} />
        <div style={{ ...fill, backgroundImage: `repeating-linear-gradient(to bottom, ${rgba(line, spec.alpha)} 0, ${rgba(line, spec.alpha)} 1px, transparent 1px, transparent ${spec.size * 2}px)` }} />
        {roll >= 0 && <div style={{ ...fill, background: `linear-gradient(to bottom, transparent ${(roll * 130 - 30).toFixed(1)}%, ${rgba(hero, 0.07)} ${(roll * 130 - 15).toFixed(1)}%, transparent ${(roll * 130).toFixed(1)}%)` }} />}
        <div style={{ ...fill, background: 'radial-gradient(ellipse 75% 62% at 50% 46%, transparent 55%, rgba(0,0,0,0.55) 100%)' }} />
      </>
    );
  }

  if (spec.kind === 'halftone') {
    // printed dots on a grid, growing toward a corner (or the bottom) and shrinking to nothing away from it
    const s2 = spec.size;
    const cols = Math.ceil(width / s2) + 1;
    const rows = Math.ceil(height / s2) + 1;
    const dots: React.ReactNode[] = [];
    const maxD = spec.from === 'corner' ? Math.hypot(width, height) : height;
    for (let yy = 0; yy < rows; yy++)
      for (let xx = 0; xx < cols; xx++) {
        const x = xx * s2 + (yy % 2 ? s2 / 2 : 0);
        const y = yy * s2;
        const d = spec.from === 'corner' ? Math.hypot(width - x, height - y) : height - y;
        const k = 1 - d / (maxD * 0.85);
        if (k <= 0.04) continue;
        dots.push(<circle key={`${xx}-${yy}`} cx={x} cy={y} r={(s2 * 0.46 * Math.min(1, k)).toFixed(2)} />);
      }
    return (
      <svg width={width} height={height} style={{ position: 'absolute', inset: 0 }}>
        <g fill={line} fillOpacity={spec.alpha}>{dots}</g>
      </svg>
    );
  }

  if (spec.kind === 'mesh') {
    // colour fields filling the frame (the glass look stands on it): bigger, more saturated and more opaque than aurora
    const fields = colours.fields.length ? colours.fields : [hero];
    const a = theme === 'dark' ? spec.alpha : spec.alpha * 0.7;
    const base: Array<[number, number, number, number]> = [[18, 16, 75, 42], [86, 38, 70, 40], [30, 70, 80, 44], [78, 92, 70, 38]];
    const layers = base.map(([bx, by, w, h], i) => {
      const c = fields[i % fields.length];
      const x = bx + Math.sin(t * spec.speed + i * 1.7) * 8;
      const y = by + Math.cos(t * spec.speed * 0.9 + i * 2.3) * 6;
      return `radial-gradient(ellipse ${w}% ${h}% at ${x.toFixed(2)}% ${y.toFixed(2)}%, ${rgba(c, a)}, ${rgba(c, 0)} 72%)`;
    });
    return (
      <>
        <div style={{ ...fill, background: layers.join(', '), filter: 'saturate(1.15)' }} />
        <Grain amount={spec.grain} theme={theme} scale={scale} />
      </>
    );
  }

  return null; // plain
};
