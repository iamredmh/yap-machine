import React from 'react';
import { OffthreadVideo, staticFile, useCurrentFrame } from 'remotion';
import { rgba } from '../engine/colour';
import { punch as punchIn } from '../engine/motion';
import { SIG } from '../engine/signature';
import { FONT, packColour, PACK } from '../engine/style';
import { tornEdge } from './rough';

// The presenter, from the footage as shot: never faked, only cropped and scaled. Three framings: full frame, and a camera
// band or tile set into the graphics. The band fills the frame below the graphics to the bottom edge, and the tile is a
// square; both are filled edge to edge with the eye line on their upper third line, zoomed in as far as that takes, and
// centred on the face. The whole head stays inside: no cutouts and no background removal, nothing to prepare but the
// edit. Measurements are in the footage's own pixels.

export type Shoot = {
  /** The plate, a video in the public folder. */
  plate: string;
  width: number;
  height: number;
  /** Face centre x, crown, eye line and chin, in footage px. Full frame places and punches in by them; the band and the tile only need faceX. */
  faceX: number;
  crown: number;
  eyes: number;
  chin: number;
  /**
   * How light the footage is where words sit over it: `chest`, the relative luminance (0 black, 1 white) of the area
   * under the chin, usually the shirt. Type with no box behind it takes its colour from this (src/kit/contrast.ts).
   */
  tone?: { chest: number };
};

/**
 * Where the footage sits for a full-frame framing: the crown at frame y `crownY`, the face centred, the frame always
 * covered. `k` is the scale for a clip 1080 px tall; a clip of another size or shape scales to match (a 720p or 4K clip
 * frames the same, a vertical one fills the frame) and never leaves a gap, so `k` in the result is the scale it got.
 */
const place = (s: Shoot, k: number, crownY: number) => {
  const kk = Math.max((k * 1080) / s.height, 1080 / s.width, 1920 / s.height);
  const w = s.width * kk;
  const h = s.height * kk;
  const left = Math.min(Math.max(540 - s.faceX * kk, 1080 - w), 0);
  const top = Math.min(Math.max(crownY - s.crown * kk, 1920 - h), 0);
  return { k: kk, w, h, left, top };
};

/** Full frame's framing (k 1.78 for a 1080p clip, the crown at y 420), as every full-frame scene shows the presenter. */
export const FULL = { k: 1.78, crownY: 420 };

/**
 * Where the head lands in a full-frame framing, in frame px: its centre x, crown, eye line and chin, and half its
 * width (about 0.4 of crown to chin). Scenes that draw over the footage keep clear of it.
 */
export const headIn = (s: Shoot, k = FULL.k, crownY = FULL.crownY) => {
  const g = place(s, k, crownY);
  return { x: g.left + s.faceX * g.k, crown: g.top + s.crown * g.k, eyes: g.top + s.eyes * g.k, chin: g.top + s.chin * g.k, half: (s.chin - s.crown) * g.k * 0.4 };
};

/**
 * The footage filling a box (x, y, w, h) by the rule of thirds: the eye line on the box's upper third line, the face
 * centred, and the box always covered. The scale is the smallest that does all three, so it zooms in only as far as
 * the eye line and the cover need.
 */
const thirds = (s: Shoot, x: number, y: number, w: number, h: number) => {
  const eyeY = y + h / 3;
  const k = Math.max(w / s.width, h / s.height, h / 3 / s.eyes, (2 * h) / 3 / (s.height - s.eyes));
  const pw = s.width * k;
  const left = Math.min(Math.max(x + w / 2 - s.faceX * k, x + w - pw), x);
  return { left, top: eyeY - s.eyes * k, w: pw, h: s.height * k };
};

/**
 * The set-in framings scenes use, in portrait px. The band runs from `top` to the bottom of the frame; captions over a
 * band shot sit on its top edge, the seam, so they never cross the face. The tile is a square whose eye line falls
 * above the caption lane.
 */
export const BAND = { top: 1000 };
export const TILE = { x: 150, y: 880, size: 780 };

const P = PACK.presenter;
const tileShadow = [P.tile.ring ? `0 0 0 ${P.tile.ring.width}px ${P.tile.ring.colour}` : '', P.tile.shadow].filter(Boolean).join(', ');

/** Full frame on the room. A punch-in scales it around the eye line. */
export const FullFrame: React.FC<{ shoot: Shoot; at: number; k: number; crownY: number; punchAt?: number; zoom?: number }> = ({ shoot, at, k, crownY, punchAt, zoom }) => {
  const f = useCurrentFrame();
  const g = place(shoot, k, crownY);
  const z = zoom ?? (punchAt != null ? punchIn(f, punchAt) : 1);
  return (
    <div data-part="presenter" style={{ position: 'absolute', inset: 0, transform: `scale(${z})`, transformOrigin: `540px ${g.top + shoot.eyes * g.k}px` }}>
      <OffthreadVideo src={plateSrc(shoot.plate)} startFrom={Math.max(0, at)} muted style={{ position: 'absolute', left: g.left, top: g.top, width: g.w, height: g.h }} />
    </div>
  );
};

/** Plates the page holding the engine already has in memory, by path (the hosted Studio's demo plate, as a blob: URL). */
const HELD = typeof window === 'undefined' ? undefined : (window as unknown as { __STYLE_PLATES__?: Record<string, string> }).__STYLE_PLATES__;

/**
 * The plate's source: one the page holds in memory, else a file in the public folder, or a URL as it is (the web app's
 * own footage, a blob: URL). Held, a preview that reloads on every change never fetches its footage again.
 */
const plateSrc = (plate: string) => HELD?.[plate] ?? (/^(blob:|https?:|data:)/.test(plate) ? plate : staticFile(plate));

/**
 * The camera as a band from `top` to the bottom of the frame. Its top edge: feathered, or hard with the pack's rule, or
 * (the signature's `edge`) torn like the page above it, with a paper rim.
 */
export const HalfBand: React.FC<{ shoot: Shoot; at: number; top: number }> = ({ shoot, at, top }) => {
  const height = 1920 - top;
  const g = thirds(shoot, 0, top, 1080, height);
  const torn = SIG.edge === 'torn';
  const fe = P.halfBand.feather;
  const edge = fe && !torn ? `linear-gradient(to bottom, transparent 0, #000 ${fe}px)` : undefined;
  const rule = torn ? null : P.halfBand.rule;
  const rip = torn ? tornEdge(1080, 0, 26, 17) : [];
  const clip = torn ? `polygon(${rip.map(([x, y]) => `${x.toFixed(0)}px ${(y + 6).toFixed(1)}px`).join(', ')}, 1080px ${height}px, 0px ${height}px)` : undefined;
  return (
    <>
      <div data-part="presenter" style={{ position: 'absolute', left: 0, top, width: 1080, height, overflow: 'hidden', WebkitMaskImage: edge, maskImage: edge, clipPath: clip }}>
        <OffthreadVideo src={plateSrc(shoot.plate)} startFrom={Math.max(0, at)} muted style={{ position: 'absolute', left: g.left, top: g.top - top, width: g.w, height: g.h }} />
      </div>
      {torn && (
        // the torn page's white rim and the shadow it casts on the camera below
        <svg width={1080} height={60} style={{ position: 'absolute', left: 0, top: top - 6, overflow: 'visible' }}>
          <polyline points={rip.map(([x, y]) => `${x},${y + 16}`).join(' ')} fill="none" stroke="rgba(0,0,0,0.28)" strokeWidth={10} strokeLinejoin="round" />
          <polygon points={`0,-8 ${rip.map(([x, y]) => `${x},${y + 8}`).join(' ')} 1080,-8`} fill={PACK.grounds[PACK.composition.ground].colour} />
          <polyline points={rip.map(([x, y]) => `${x},${y + 10}`).join(' ')} fill="none" stroke="#FFFFFF" strokeWidth={6} strokeLinejoin="round" />
        </svg>
      )}
      {rule && <div data-part="band-rule" style={{ position: 'absolute', left: 0, width: 1080, top: top - rule.width / 2, height: rule.width, background: packColour(rule.colour) }} />}
    </>
  );
};

/**
 * The camera in a tile, with the pack's corners, ring and shadow, leaning as the signature says. Its chrome: a window's
 * title bar (three lights and a file name), or tape on its top corners.
 */
export const Tile: React.FC<{ shoot: Shoot; at: number; x: number; y: number; w: number; h: number }> = ({ shoot, at, x, y, w, h }) => {
  const g = thirds(shoot, x, y, w, h);
  const bar = SIG.chrome === 'window' ? 56 : 0;
  const lean = SIG.tilt ? `rotate(${SIG.tilt * 0.8}deg)` : undefined;
  const pal = PACK.palette;
  return (
    <div style={{ position: 'absolute', left: x, top: y - bar, width: w, height: h + bar, transform: lean }}>
      <div data-part="presenter" style={{ position: 'absolute', left: 0, top: 0, width: w, height: h + bar, overflow: 'hidden', borderRadius: P.tile.radius, boxShadow: tileShadow, background: bar ? pal.panel : undefined }}>
        <OffthreadVideo src={plateSrc(shoot.plate)} startFrom={Math.max(0, at)} muted style={{ position: 'absolute', left: g.left - x, top: g.top - y + bar, width: g.w, height: g.h }} />
        {bar > 0 && (
          <div style={{ position: 'absolute', left: 0, top: 0, width: w, height: bar, background: pal.panel, display: 'flex', alignItems: 'center', gap: 12, padding: '0 22px', boxShadow: `inset 0 -2px 0 ${pal.line}` }}>
            {['#FF5F56', '#FFBD2E', '#27C93F'].map((c) => <span key={c} style={{ width: 16, height: 16, borderRadius: SIG.surface === 'terminal' ? 0 : 8, background: c }} />)}
            <span style={{ marginLeft: 14, font: `400 24px ${FONT.code}`, color: pal.textSoft, letterSpacing: '0.02em' }}>camera.mp4</span>
          </div>
        )}
      </div>
      {SIG.chrome === 'tape' &&
        [-1, 1].map((d) => (
          <div key={d} style={{ position: 'absolute', top: -18, left: d < 0 ? -34 : w - 106, width: 140, height: 46, background: rgba('#F2E6C9', 0.8), boxShadow: '0 2px 4px rgba(0,0,0,0.12)', transform: `rotate(${d * 34}deg)` }} />
        ))}
    </div>
  );
};
