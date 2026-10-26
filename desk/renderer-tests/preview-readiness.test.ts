import { describe, expect, it } from 'vitest';
import { previewCanPaint, PreviewPaintGate, type PreviewReadiness } from '../../studio/preview/readiness';

describe('first visible preview frame', () => {
  const ready: PreviewReadiness = { fontsLoaded: true, buffering: false, pendingMasks: 0, videos: [{ readyState: 2, seeking: false }] };
  it('waits for fonts, current video pixels, seek completion, and mask playback blockers', () => {
    expect(previewCanPaint(ready)).toBe(true);
    expect(previewCanPaint({ ...ready, fontsLoaded: false })).toBe(false);
    expect(previewCanPaint({ ...ready, buffering: true })).toBe(false);
    expect(previewCanPaint({ ...ready, pendingMasks: 1 })).toBe(false);
    expect(previewCanPaint({ ...ready, videos: [{ readyState: 1, seeking: false }] })).toBe(false);
    expect(previewCanPaint({ ...ready, videos: [{ readyState: 2, seeking: true }] })).toBe(false);
  });
  it('a newly sought revision cannot inherit a previous frame’s ready observations', () => {
    const gate = new PreviewPaintGate();
    expect(gate.observe(1, true)).toBe(false);
    expect(gate.observe(1, true)).toBe(false);
    expect(gate.observe(2, true)).toBe(false);
    expect(gate.observe(2, true)).toBe(false);
    expect(gate.observe(2, true)).toBe(true);
  });
  it('a late buffering event resets readiness before the replacement is revealed', () => {
    const gate = new PreviewPaintGate();
    gate.observe(4, true); gate.observe(4, true);
    expect(gate.observe(4, false)).toBe(false);
    expect(gate.observe(4, true)).toBe(false);
    expect(gate.observe(4, true)).toBe(false);
    expect(gate.observe(4, true)).toBe(true);
  });
});
