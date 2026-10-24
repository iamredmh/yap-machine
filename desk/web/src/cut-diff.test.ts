import { describe, expect, it } from "vitest";
import { SMALL_CHANGE, diffCuts, mapTime, noteNow, viewInA, type CutSeg } from "./cut-diff.js";

/** A segment: where it sits in the cut (t to e), and which stretch of which raw source it is (ss to se). */
const seg = (t: number, e: number, ss: number, se: number, text = "line", src = "cam"): CutSeg => ({ t, e, src, ss, se, text, beat: "b" });

// A: intro 0-4 (source 10-14), middle 4-9 (source 30-35), end 9-12 (source 50-53)
const A = [seg(0, 4, 10, 14, "intro"), seg(4, 9, 30, 35, "middle"), seg(9, 12, 50, 53, "end")];

describe("mapTime", () => {
  it("finds the same moment in an identical cut", () => {
    expect(mapTime(A, 5, A)).toBeCloseTo(5, 6);
    expect(mapTime(A, 0, A)).toBeCloseTo(0, 6);
  });
  it("follows the footage when something is added before it", () => {
    // B has an extra 3 s line first (source 100-103); everything else is 3 s later
    const B = [seg(0, 3, 100, 103, "new"), seg(3, 7, 10, 14), seg(7, 12, 30, 35), seg(12, 15, 50, 53)];
    expect(mapTime(A, 5, B)).toBeCloseTo(8, 6);     // 'middle' + 1 s
    expect(mapTime(B, 8, A)).toBeCloseTo(5, 6);
    expect(mapTime(B, 1, A)).toBeNull();            // the new line isn't in A
  });
  it("is null for a moment that was cut", () => {
    const B = [seg(0, 4, 10, 14), seg(4, 7, 50, 53)];   // 'middle' is gone
    expect(mapTime(A, 6, B)).toBeNull();
    expect(mapTime(A, 10, B)).toBeCloseTo(5, 6);       // 'end' moved up
  });
  it("does not confuse two raw sources that share a time range", () => {
    const B = [seg(0, 4, 10, 14, "intro", "screen")];
    expect(mapTime(A, 2, B)).toBeNull();
  });
  it("keeps the speed when a segment is stretched or squeezed", () => {
    const B = [seg(0, 8, 10, 14)];      // the same 4 s of footage played over 8 s
    expect(mapTime(A, 2, B)).toBeCloseTo(4, 6);
  });
  it("copes with the end of the cut and with nothing to map", () => {
    expect(mapTime(A, 12, A)).toBeCloseTo(12, 3);
    expect(mapTime([], 1, A)).toBeNull();
    expect(mapTime(A, 1, [])).toBeNull();
  });
});

describe("diffCuts", () => {
  it("finds nothing between identical cuts", () => {
    const d = diffCuts(A, A);
    expect(d.added).toEqual([]); expect(d.removed).toEqual([]);
    expect(d.addedSeconds).toBe(0); expect(d.removedSeconds).toBe(0);
  });
  it("lists a line that was added and a line that was cut, each at its own version's time", () => {
    const B = [seg(0, 4, 10, 14), seg(4, 8, 100, 104, "brand new"), seg(8, 11, 50, 53)];  // 'middle' out, 'brand new' in
    const d = diffCuts(A, B);
    expect(d.added).toHaveLength(1);
    expect(d.added[0]).toMatchObject({ from: 4, to: 8, text: "brand new", partial: false });
    expect(d.removed).toHaveLength(1);
    expect(d.removed[0]).toMatchObject({ from: 4, to: 9, text: "middle", partial: false });
    expect(d.addedSeconds).toBeCloseTo(4, 6); expect(d.removedSeconds).toBeCloseTo(5, 6);
  });
  it("calls a moved cut edge a small trim, not a change", () => {
    // B's 'intro' starts 0.12 s earlier in the footage and ends 0.2 s later
    const B = [seg(0, 4.32, 9.88, 14.2, "intro"), seg(4.32, 9.32, 30, 35), seg(9.32, 12.32, 50, 53)];
    const d = diffCuts(A, B);
    expect(d.added).toEqual([]); expect(d.removed).toEqual([]);
    expect(d.trimsAdded).toHaveLength(2);
    expect(d.trimsAdded.every((p) => p.to - p.from < SMALL_CHANGE && p.partial)).toBe(true);
    expect(d.addedSeconds).toBeCloseTo(0.32, 3);
  });
  it("shows a partly-new line with its new part's own times", () => {
    // B keeps A's 'middle' (30-35) but runs on to 37: 2 s more of the same take
    const B = [seg(0, 4, 10, 14), seg(4, 11, 30, 37, "middle and more"), seg(11, 14, 50, 53)];
    const d = diffCuts(A, B);
    expect(d.added).toHaveLength(1);
    expect(d.added[0]).toMatchObject({ partial: true });
    expect(d.added[0].from).toBeCloseTo(9, 6); expect(d.added[0].to).toBeCloseTo(11, 6);
  });
  it("makes one change out of neighbouring pieces that run on from each other", () => {
    const B = [seg(0, 4, 10, 14), seg(4, 6, 100, 102, "one"), seg(6, 9, 102, 105, "two"), seg(9, 14, 30, 35), seg(14, 17, 50, 53)];
    const d = diffCuts(A, B);
    expect(d.added).toHaveLength(1);
    expect(d.added[0].from).toBe(4); expect(d.added[0].to).toBe(9);
    expect(d.added[0].text).toContain("one"); expect(d.added[0].text).toContain("two");
  });
  it("is not fooled by a different raw source with the same times", () => {
    const B = [seg(0, 4, 10, 14, "intro", "screen")];
    const d = diffCuts([seg(0, 4, 10, 14)], B);
    expect(d.added).toHaveLength(1); expect(d.removed).toHaveLength(1);
  });
});

describe("notes", () => {
  it("says where a note on the older version is now, or that its part was cut", () => {
    const B = [seg(0, 4, 10, 14), seg(4, 7, 50, 53)];
    expect(noteNow(A, B, 2)).toEqual({ at: expect.closeTo(2, 6) });
    expect(noteNow(A, B, 6)).toEqual({ cut: true });
    expect(noteNow(A, B, 10)).toEqual({ at: expect.closeTo(5, 6) });
  });
});

describe("viewInA", () => {
  const B = [seg(0, 3, 100, 103, "new"), seg(3, 7, 10, 14), seg(7, 12, 30, 35), seg(12, 15, 50, 53)];
  it("is the same stretch of words in the other version", () => {
    const v = viewInA(B, A, { start: 3, end: 7 }, 12);
    expect(v.start).toBeCloseTo(0, 2);
    expect(v.end).toBeCloseTo(4, 2);
    const w = viewInA(B, A, { start: 8, end: 12 }, 12);
    expect(w.start).toBeCloseTo(5, 2);
    expect(w.end).toBeCloseTo(9, 2);
  });
  it("takes the nearest moment that both versions have when an end falls on something new", () => {
    const v = viewInA(B, A, { start: 1, end: 5 }, 12);       // starts inside the new line, ends two seconds into 'intro'
    expect(v.start).toBeCloseTo(0, 1);
    expect(v.end).toBeCloseTo(2, 1);
  });
  it("shows a second of A where B is all new, and never leaves A", () => {
    const v = viewInA(B, A, { start: 0.5, end: 2.5 }, 12);
    expect(v.end - v.start).toBeGreaterThanOrEqual(1);
    expect(v.start).toBeGreaterThanOrEqual(0);
    expect(v.end).toBeLessThanOrEqual(12);
    const w = viewInA(B, A, { start: 13, end: 15 }, 12);
    expect(w.end).toBeLessThanOrEqual(12);
    expect(w.start).toBeGreaterThanOrEqual(0);
    expect(viewInA([], A, { start: 0, end: 5 }, 12).end).toBeLessThanOrEqual(12);
  });
});
