import { describe, expect, it } from 'vitest';
import { timelinePage } from './timeline-layout.js';
describe('readable effect pages', () => {
  it('keeps every effect reachable without scrolling a tiny track area', () => {
    const shown = Array.from({ length: 4 }, (_, p) => timelinePage(11, p));
    expect(shown.flatMap(p => Array.from({ length: p.end - p.start }, (_, i) => p.start + i))).toEqual(Array.from({ length: 11 }, (_, i) => i));
  });
  it('recovers when deleting the last row of the last page', () => {
    expect(timelinePage(3, 1)).toEqual({ page: 0, start: 0, end: 3 });
    expect(timelinePage(0, 5)).toEqual({ page: 0, start: 0, end: 0 });
  });
});
