import React from 'react';
import { onColour, rgba } from '../engine/colour';
import { reveal, spring01, tw } from '../engine/motion';
import { FONT, packColour, PACK } from '../engine/style';
import { Mark } from './Mark';
import { rng } from './rough';

// The spoken-word subtitles, from the pack's `subtitles`: a voice, size and case; an outline and hard shadow for
// subtitles straight on footage, or a scrim or pill behind the line; and the key word in its own voice, optionally on
// a box in a colour.

const S = PACK.subtitles;

/** A colour at alpha 0, so a scrim fades to nothing in its own colour. */
const clear = (c: string) => c.replace(/rgba\(([^,]+),([^,]+),([^,]+),[^)]+\)/, 'rgba($1,$2,$3,0)');

/**
 * How a line arrives, `since` frames after it came on, by the pack's `enter`: popping in on the spring, rising, typed
 * in from the left (in steps of about a letter), out of a blur, or in steps like drawn animation. Settled after about
 * ten frames; a line with no `since` (a scene's own) holds as it is.
 */
const entering = (on: number | undefined, count: number): React.CSSProperties => {
  const kind = S.enter ?? 'cut';
  if (on == null || kind === 'cut') return {};
  // counted from one, so a line already shows on the frame it comes on and back-to-back lines never blink
  const since = on + 1;
  if (kind === 'pop') {
    const s = spring01(since);
    return { transform: `scale(${(0.72 + 0.28 * s).toFixed(3)})`, opacity: Math.min(1, since / 3) };
  }
  if (kind === 'type') {
    const steps = Math.max(4, count);
    const p = Math.ceil(tw(since, 0, Math.min(14, steps * 0.6)) * steps) / steps;
    return p >= 1 ? {} : { clipPath: `inset(-40% ${((1 - p) * 100).toFixed(1)}% -40% -4%)` };
  }
  if (kind === 'stepped') {
    const fq = Math.floor(since / 2) * 2;
    const p = tw(fq, 0, 8, reveal);
    const r = rng(fq * 17 + 5);
    const j = p < 1 ? 2 : 0;
    return { transform: `translate(${((r() * 2 - 1) * j).toFixed(1)}px, ${((1 - p) * 22 + (r() * 2 - 1) * j).toFixed(1)}px) rotate(${((r() * 2 - 1) * j * 0.4).toFixed(2)}deg)`, opacity: p > 0.05 ? 1 : 0 };
  }
  const p = tw(since, 0, kind === 'blur' ? 12 : 9, reveal);
  if (kind === 'blur') return { transform: `translateY(${((1 - p) * 12).toFixed(1)}px)`, filter: p < 1 ? `blur(${((1 - p) * 14).toFixed(1)}px)` : undefined, opacity: Math.min(1, p * 1.5) };
  return { transform: `translateY(${((1 - p) * 26).toFixed(1)}px)`, opacity: p };
};

/** The letters in a line, for typing it in. */
const letters = (n: React.ReactNode): number =>
  typeof n === 'string' || typeof n === 'number' ? String(n).length : Array.isArray(n) ? n.reduce((a: number, c) => a + letters(c), 0) : React.isValidElement(n) ? letters((n.props as { children?: React.ReactNode }).children) : 0;

/**
 * `seam`: the line rides the edge of a camera band, so it gets a backing in the ground colour that the band's rule
 * passes behind. `since`: frames since the line came on, so it arrives by the pack's `enter` (the reel's caption track).
 * `edge`: the line is straight on footage, and this is the opposite tone (src/kit/contrast.ts); a line with no backing,
 * outline or shadow of its own gets a soft halo in it, so it reads where the footage varies.
 */
export const Sub: React.FC<{ y?: number; light?: boolean; seam?: boolean; since?: number; edge?: string; children: React.ReactNode }> = ({ y = S.laneY, light = false, seam = false, since, edge, children }) => {
  const back = light ? S.backing.light : S.backing.dark;
  const shadow = (light ? S.shadow.light : S.shadow.dark) ?? (edge && S.backing.kind === 'none' && !S.outline ? `0 0 3px ${rgba(edge, 0.9)}, 0 2px 14px ${rgba(edge, 0.75)}` : undefined);
  const outline: React.CSSProperties = S.outline ? { WebkitTextStroke: `${S.outline.width}px ${light ? S.outline.light : S.outline.dark}`, paintOrder: 'stroke fill' } : {};
  return (
    <div data-part="captions" style={{ position: 'absolute', left: 0, right: 0, top: y, transform: 'translateY(-50%)', textAlign: 'center', zIndex: 5 }}>
      <span
        style={{
          position: 'relative',
          display: 'inline-block',
          padding: S.backing.kind === 'pill' || S.backing.kind === 'glass' ? '14px 34px' : S.backing.kind === 'box' || S.backing.kind === 'block' ? '14px 30px' : '12px 30px',
          font: `${S.weight} ${S.size}px/1 ${FONT[S.voice]}`,
          color: light ? S.colour.light : S.colour.dark,
          letterSpacing: `${S.tracking}em`,
          textTransform: S.case,
          textShadow: shadow,
          ...outline,
          ...entering(since, letters(children)),
        }}
      >
        {S.backing.kind === 'scrim' && <span style={{ position: 'absolute', inset: '-18px -40px', background: `radial-gradient(closest-side, ${back}, ${clear(back)})`, filter: 'blur(6px)', zIndex: -1 }} />}
        {S.backing.kind === 'pill' && <span style={{ position: 'absolute', inset: 0, background: back, borderRadius: 999, zIndex: -1 }} />}
        {S.backing.kind === 'glass' && (
          <span style={{ position: 'absolute', inset: 0, background: back, borderRadius: 999, zIndex: -1, backdropFilter: 'blur(18px) saturate(1.5)', WebkitBackdropFilter: 'blur(18px) saturate(1.5)', boxShadow: `inset 0 0 0 1.5px ${light ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.25)'}` }} />
        )}
        {S.backing.kind === 'box' && <span style={{ position: 'absolute', inset: 0, background: back, borderRadius: 10, zIndex: -1, boxShadow: `inset 0 0 0 4px ${PACK.palette.ink}, 8px 8px 0 ${PACK.palette.ink}` }} />}
        {S.backing.kind === 'block' && <span style={{ position: 'absolute', inset: 0, background: back, zIndex: -1 }} />}
        {seam && S.backing.kind !== 'pill' && S.backing.kind !== 'glass' && S.backing.kind !== 'box' && S.backing.kind !== 'block' && <span style={{ position: 'absolute', inset: '0 6px', background: PACK.grounds[light ? 'light' : 'dark'].colour, borderRadius: 14, zIndex: -1 }} />}
        {children}
      </span>
    </div>
  );
};

/** The key word in a subtitle line. */
export const SubKey: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const k = S.key;
  const font = `${k.style} ${k.weight} ${k.size}px/1 ${FONT[k.voice]}`;
  if (!k.box && k.mark) {
    // marked by hand: the words in the line's colour, the mark in the hero colour
    return (
      <span data-part="keyword" style={{ font, color: k.colour ? packColour(k.colour) : undefined, WebkitTextStroke: k.mark === 'highlight' ? 0 : undefined, textShadow: k.mark === 'highlight' ? 'none' : undefined }}>
        <Mark kind={k.mark} hero={packColour('hero')} at={4} seed={29}>
          <span style={k.mark === 'highlight' ? { color: PACK.palette.ink, padding: '0 0.08em' } : undefined}>{children}</span>
        </Mark>
      </span>
    );
  }
  if (!k.box) return <span data-part="keyword" style={{ font, color: k.colour ? packColour(k.colour) : undefined }}>{children}</span>;
  const fill = packColour(k.box.colour);
  return (
    <span
      data-part="keyword"
      style={{
        font,
        display: 'inline-block',
        padding: `${k.box.padY}em ${k.box.padX}em`,
        margin: `0 ${k.box.padX * 0.3}em`,
        color: k.colour ? packColour(k.colour) : onColour(fill),
        background: fill,
        borderRadius: k.box.radius,
        boxShadow: k.box.border ? `inset 0 0 0 ${k.box.border.width}px ${packColour(k.box.border.colour)}, ${Math.round(k.box.border.width * 1.5)}px ${Math.round(k.box.border.width * 1.5)}px 0 ${packColour(k.box.border.colour)}` : undefined,
        transform: `rotate(${k.box.tilt}deg)`,
        WebkitTextStroke: 0,
        textShadow: 'none',
      }}
    >
      {children}
    </span>
  );
};
