import { describe, expect, it } from 'vitest';
import { changeHistory, clampTime, effectIssue, historyOf, recoverDraft, travelHistory } from './studio-state.js';
describe('editing history', () => {
  it('undoes removal and branches correctly after undo', () => {
    const original = { preset: 'glass', effects: [{ id: 'one' }] };
    let h = changeHistory(historyOf(original), { ...original, effects: [] });
    h = travelHistory(h, 'undo');
    expect(h.present).toEqual(original);
    h = changeHistory(h, { ...original, preset: 'pop' });
    expect(h.future).toEqual([]);
    expect(travelHistory(h, 'redo').present.preset).toBe('pop');
    expect(travelHistory(h, 'undo').present).toEqual(original);
  });
  it('coalesces typing into one edit without mutating previous snapshots', () => {
    let h = changeHistory(historyOf(''), 'a');
    h = changeHistory(h, 'ab', true);
    expect(travelHistory(h, 'undo').present).toBe('');
    expect(travelHistory(travelHistory(h, 'undo'), 'redo').present).toBe('ab');
  });
});
describe('effect readiness and placement', () => {
  const effect = { type: 'snap-zoom', at: 2, duration: 2.5 };
  it('clamps seeks to actual frames, including zero and invalid numbers', () => {
    expect(clampTime(0, 8)).toBe(0);
    expect(clampTime(9, 8)).toBeCloseTo(7.9667, 3);
    expect(clampTime(NaN, 8)).toBe(0);
  });
  it('explains incomplete input before rendering', () => {
    expect(effectIssue(effect, 8)).toBeNull();
    expect(effectIssue({ ...effect, type: 'growth-curve' }, 8)).toMatch(/two numbers/);
    expect(effectIssue({ ...effect, type: 'b-roll-overlay' }, 8)).toMatch(/image or video/);
    expect(effectIssue({ ...effect, type: 'checklist', items: ['  '] }, 8)).toMatch(/checklist item/);
    expect(effectIssue({ ...effect, duration: 9 }, 8)).toMatch(/within/);
    expect(effectIssue({ ...effect, enabled: false, type: 'growth-curve' }, 8)).toBeNull();
  });
  it('requires a real cut boundary for a transition', () => {
    expect(effectIssue({ ...effect, type: 'zoom-through-cut' }, 8, [1, 5])).toMatch(/boundary/);
    expect(effectIssue({ ...effect, type: 'zoom-through-cut' }, 8, [3])).toBeNull();
  });
  it('requires words and valid placement for behind-person text, and two values for a count-up', () => {
    expect(effectIssue({ ...effect, type: 'text-behind-person' }, 8)).toMatch(/words/);
    expect(effectIssue({ ...effect, type: 'text-behind-person', text: 'My story', textSize: .2, textY: .4 }, 8)).toBeNull();
    expect(effectIssue({ ...effect, type: 'text-behind-person', text: 'My story', textSize: .9 }, 8)).toMatch(/size/);
    expect(effectIssue({ ...effect, type: 'text-behind-person', text: 'My story', textY: 0 }, 8)).toMatch(/down/);
    expect(effectIssue({ ...effect, type: 'count-up', values: [10] }, 8)).toMatch(/starting number/);
    expect(effectIssue({ ...effect, type: 'count-up', values: [NaN, 12] }, 8)).toMatch(/valid numbers/);
    expect(effectIssue({ ...effect, type: 'count-up', values: [0, 12.5] }, 8)).toBeNull();
  });
});
describe('draft recovery', () => {
  const draft = JSON.stringify({ rev: 2, timelineRev: 'abc', settings: { preset: 'pop', effects: [] } });
  it('recovers drafts only for the same saved settings and timeline', () => {
    expect(recoverDraft(draft, 2, 'abc')?.preset).toBe('pop');
    expect(recoverDraft(draft, 3, 'abc')).toBeNull();
    expect(recoverDraft(draft, 2, 'changed')).toBeNull();
    expect(recoverDraft('{broken', 2, 'abc')).toBeNull();
  });
});
