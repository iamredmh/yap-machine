/** Editor history is independent of saving: saving must not erase undo. */
export type History<T> = { past: T[]; present: T; future: T[] };
export const historyOf = <T>(present: T): History<T> => ({ past: [], present, future: [] });
export function changeHistory<T>(h: History<T>, value: T, coalesce = false): History<T> {
  if (JSON.stringify(h.present) === JSON.stringify(value)) return h;
  return { past: coalesce && h.past.length ? h.past : [...h.past, h.present].slice(-80), present: value, future: [] };
}
export function travelHistory<T>(h: History<T>, direction: 'undo' | 'redo'): History<T> {
  if (direction === 'undo') return h.past.length ? { past: h.past.slice(0, -1), present: h.past.at(-1)!, future: [h.present, ...h.future] } : h;
  return h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h;
}
export const clampTime = (time: number, duration: number) => Math.max(0, Math.min(Number.isFinite(time) ? time : 0, Math.max(0, duration - 1 / 30)));
export function effectIssue(e: any, duration: number, boundaries: number[] = []): string | null {
  if (!Number.isFinite(e.at) || e.at < 0 || e.at >= duration) return 'Choose a start inside this cut.';
  if (!Number.isFinite(e.duration) || e.duration < .1 || e.duration > 60 || e.at + e.duration > duration + .001) return 'Keep the effect within this cut (0.1–60 seconds).';
  if (e.items?.filter((v: string) => v.trim()).length > 8 || e.items?.some((v: string) => v.trim().length > 80)) return 'Use up to eight items, with 80 characters per item.';
  if (e.values?.length > 12 || e.values?.some((v: number) => !Number.isFinite(v) || Math.abs(v) > 1e12)) return 'Use up to twelve valid numbers between −1 trillion and 1 trillion.';
  if (e.textSize !== undefined && (!Number.isFinite(e.textSize) || e.textSize < .06 || e.textSize > .3)) return 'Choose a text size from 6% to 30%.';
  if (e.textY !== undefined && (!Number.isFinite(e.textY) || e.textY < .1 || e.textY > .85)) return 'Place the text between 10% and 85% down the picture.';
  if (e.enabled === false) return null;
  if (['checklist', 'checklist-pop', 'headline-storm'].includes(e.type) && !e.items?.some((v: string) => v.trim())) return e.type === 'headline-storm' ? 'Add at least one headline.' : 'Add at least one checklist item.';
  if (e.type === 'growth-curve' && (!Array.isArray(e.values) || e.values.length < 2 || !e.values.every(Number.isFinite))) return 'Add at least two numbers for the chart.';
  if (e.type === 'count-up' && (!Array.isArray(e.values) || e.values.length !== 2)) return 'Add a starting number and your final total.';
  if (e.type === 'text-behind-person' && !e.text?.trim()) return 'Add the words you want to place behind you.';
  if (['green-screen', 'b-roll-overlay'].includes(e.type) && !e.asset) return 'Add an image or video to see this effect.';
  if (e.type === 'zoom-through-cut' && !boundaries.some(t => t >= e.at && t < e.at + e.duration)) return 'Place this effect across a cut boundary.';
  return null;
}
export function recoverDraft(raw: string | null, rev: number, timelineRev: string): any | null {
  try {
    const d = JSON.parse(raw ?? 'null');
    return d?.rev === rev && d.timelineRev === timelineRev && typeof d.settings?.preset === 'string' && Array.isArray(d.settings.effects) ? d.settings : null;
  } catch { return null; }
}
