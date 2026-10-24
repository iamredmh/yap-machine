/**
 * A frame for the Look screen's live preview, with nothing burned into it. A short's render has its captions and name card in the
 * picture, so drawing the live ones on top showed both. The camera footage still has none: the first segment of the short says which
 * stretch of which source it is and how it was reframed, so one frame of that, cropped the same way, is the picture without overlays.
 */

export interface LookSeg { source?: string; start?: number; end?: number; crop?: number[]; screen?: unknown }

/** A moment a little way into the segment, so it isn't the first frame, which can be a fade. */
export function lookMoment(seg: LookSeg): number {
  const start = Number(seg.start ?? 0), end = Number(seg.end ?? start);
  return Math.max(0, start + Math.min(1.2, Math.max(0, end - start) / 2));
}

/** The crop the render used (render.py): the same fractions of the source, rounded down to an even size. */
export function cropFilter(crop: number[]): string | null {
  if (!Array.isArray(crop) || crop.length !== 4 || !crop.every((n) => Number.isFinite(n))) return null;
  const [x, y, cw, ch] = crop;
  if (!(cw > 0 && ch > 0 && x >= 0 && y >= 0 && x + cw <= 1.001 && y + ch <= 1.001)) return null;
  return `crop=trunc(iw*${cw.toFixed(5)}/2)*2:trunc(ih*${ch.toFixed(5)}/2)*2:trunc(iw*${x.toFixed(5)}):trunc(ih*${y.toFixed(5)})`;
}

/** ffmpeg's arguments for the frame, or null when the segment can't give a clean one (a screen layer is composited in, or there's no crop). */
export function lookFrameArgs(seg: LookSeg, sourcePath: string, out: string): string[] | null {
  if (seg.screen || !seg.crop) return null;
  const crop = cropFilter(seg.crop);
  if (!crop) return null;
  return ["-v", "error", "-y", "-nostdin", "-ss", lookMoment(seg).toFixed(3), "-i", sourcePath, "-frames:v", "1", "-vf", `${crop},scale=480:-2`, "-q:v", "4", out];
}
