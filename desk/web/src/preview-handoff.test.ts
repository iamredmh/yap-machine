import { describe, expect, it } from 'vitest';
import { PreviewHandoff } from './preview-handoff.js';

describe('preview document handoff', () => {
  it('keeps the painted frame until its replacement acknowledges the latest request', () => {
    const h = new PreviewHandoff<{ frame: number }>();
    const first = h.request('clean', { frame: 24 });
    expect(h.reveal(first.id, first.revision)).toBe(true);
    const second = h.request('editorial', { frame: 48 });
    expect(h.entries()).toEqual([first, second]);
    expect(h.visible).toBe(first);
    expect(h.reveal(second.id, second.revision)).toBe(true);
    expect(h.entries()).toEqual([second]);
  });

  it('rejects an old style acknowledgment after rapid switches, even when returning to that style', () => {
    const h = new PreviewHandoff<number>();
    const first = h.request('clean', 20); h.reveal(first.id, first.revision);
    const stale = h.request('bold', 20);
    h.request('glass', 20);
    const newest = h.request('bold', 36);
    expect(h.reveal(stale.id, stale.revision)).toBe(false);
    expect(h.visible).toBe(first);
    expect(h.entries()).toHaveLength(2);
    expect(h.reveal(newest.id, newest.revision)).toBe(true);
    expect(h.visible?.value).toBe(36);
  });

  it('does not reveal an old seek or plan when the same loading iframe receives a newer frame', () => {
    const h = new PreviewHandoff<number>();
    const first = h.request('clean', 20); h.reveal(first.id, first.revision);
    const loading = h.request('editorial', 24);
    const sought = h.request('editorial', 96);
    expect(sought.id).toBe(loading.id);
    expect(h.reveal(loading.id, loading.revision)).toBe(false);
    expect(h.visible).toBe(first);
    expect(h.reveal(sought.id, sought.revision)).toBe(true);
    expect(h.visible?.value).toBe(96);
  });

  it('freezes a painted same-style document while a cold seek loads and reuses the pending document during dragging', () => {
    const h = new PreviewHandoff<{ frame: number; effects: string[] }>();
    const painted = h.request('clean', { frame: 19, effects: ['behind'] });
    h.reveal(painted.id, painted.revision);
    const cold = h.request('clean', { frame: 90, effects: ['behind'] });
    expect(cold.id).not.toBe(painted.id);
    expect(h.visible).toBe(painted);
    const dragged = h.request('clean', { frame: 108, effects: ['behind'] });
    expect(dragged.id).toBe(cold.id);
    expect(h.entries()).toEqual([painted, dragged]);
    expect(h.reveal(cold.id, cold.revision)).toBe(false);
    expect(h.visible?.value.frame).toBe(19);
    expect(h.reveal(dragged.id, dragged.revision)).toBe(true);
    expect(h.visible?.value.frame).toBe(108);
  });

  it('keeps the old composition painted while adding or removing effects in the same look', () => {
    const h = new PreviewHandoff<string[]>();
    const painted = h.request('glass', []); h.reveal(painted.id, painted.revision);
    const added = h.request('glass', ['behind', 'counter']);
    expect(h.visible?.value).toEqual([]);
    expect(added.id).not.toBe(painted.id);
    h.reveal(added.id, added.revision);
    const removed = h.request('glass', []);
    expect(removed.id).not.toBe(added.id);
    expect(h.visible?.value).toEqual(['behind', 'counter']);
    expect(h.entries()).toHaveLength(2);
  });
});
