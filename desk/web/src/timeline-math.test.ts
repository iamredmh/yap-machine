import { describe, expect, it } from "vitest";
import { NO_RANGE, PAUSED, SPEEDS, clock, clockOf, isTyping, keyAction, loopJump, markersFor, playLabel, press, quietRuns, rangeLabel, readSpeed, rulerTicks, setEdge, stepFrames, stepMarker, stepSpeed, tickStep } from "./timeline-math.js";

describe("ruler", () => {
  it("formats m:ss and, from an hour, h:mm:ss", () => {
    expect(clock(38.9)).toBe("0:38");
    expect(clock(213.84)).toBe("3:33");
    expect(clock(3725)).toBe("1:02:05");
    expect(clockOf(38, 213)).toBe("0:38 of 3:33");
  });
  it("picks a sensible step for a short, a 3:33 cut and an hour, keeping labels apart", () => {
    expect(tickStep(30, 300)).toBe(10);       // a vertical short in a narrow card
    expect(tickStep(213.84, 1100)).toBe(15);  // v5 at full width: ~77 px per 15 s
    expect(tickStep(3600, 1100)).toBe(300);   // an hour: every five minutes
    for (const [d, w] of [[30, 300], [213.84, 1100], [3600, 1100], [5400, 390]] as const) {
      const ticks = rulerTicks(d, w);
      expect((ticks[1].x - ticks[0].x) * w).toBeGreaterThanOrEqual(76);
    }
  });
  it("starts at 0:00, ends within the cut, and labels from the clock", () => {
    const t = rulerTicks(213.84, 1100);
    expect(t[0]).toMatchObject({ t: 0, x: 0, label: "0:00" });
    expect(t.at(-1)!.t).toBeLessThanOrEqual(213.84);
    expect(t[1].label).toBe("0:15");
    expect(rulerTicks(3600, 1100).at(-1)!.label).toBe("1:00:00");
  });
  it("copes with nothing to draw", () => { expect(rulerTicks(0, 500)).toEqual([]); expect(tickStep(0, 0)).toBe(1); });
});

describe("markers", () => {
  const notes = [{ id: "b", at: 40, text: "second" }, { id: "a", at: 12, text: "first" }];
  const joins = [{ n: 2, at: 25, flags: ["repeats a word"] }, { n: 1, at: 5, flags: [] }, { n: 3, at: 100, flags: ["room tone jumps"] }];
  const m = markersFor(notes, joins);
  it("sorts notes and flagged joins together and leaves unflagged joins out", () => {
    expect(m.map((x) => x.id)).toEqual(["note-a", "join-2", "note-b", "join-3"]);
  });
  it("sends a join to a second before the cut, never before zero", () => {
    expect(m.find((x) => x.id === "join-2")!.seekAt).toBe(24);
    expect(markersFor([], [{ n: 1, at: 0.4, flags: ["x"] }])[0].seekAt).toBe(0);
  });
  it("steps to the next and previous marker, and stops at the ends", () => {
    expect(stepMarker(m, 0, 1)!.marker.id).toBe("note-a");
    expect(stepMarker(m, 12, 1)!.marker.id).toBe("join-2");
    expect(stepMarker(m, 100, 1)).toBeNull();
    expect(stepMarker(m, 40, -1)!.marker.id).toBe("join-2");
    expect(stepMarker(m, 12.2, -1)).toBeNull(); // 0.2 s past the first marker is still 'on' it
    expect(stepMarker(m, 11, -1)).toBeNull();
    expect(stepMarker(m, 200, -1)!.marker.id).toBe("join-3");
  });
});

describe("quiet stretches", () => {
  it("finds runs under the threshold that last at least 0.6 s", () => {
    // 100 peaks over 10 s: 0.1 s each. Quiet 10..16 (0.6 s, kept), 30..35 (0.5 s, dropped), 60..80 (2 s, kept)
    const peaks = Array.from({ length: 100 }, (_, i) => ((i >= 10 && i < 16) || (i >= 30 && i < 35) || (i >= 60 && i < 80) ? 0.01 : 0.7));
    const runs = quietRuns(peaks, 10, 0.05);
    expect(runs).toHaveLength(2);
    expect(runs[0].from).toBeCloseTo(1, 5); expect(runs[0].to).toBeCloseTo(1.6, 5);
    expect(runs[1].from).toBeCloseTo(6, 5); expect(runs[1].to).toBeCloseTo(8, 5);
  });
  it("counts a quiet end of the cut, and nothing for a cut with no peaks", () => {
    expect(quietRuns([0.8, 0.8, 0, 0, 0, 0], 6, 0.05, 2)).toEqual([{ from: 2, to: 6 }]);
    expect(quietRuns([], 6)).toEqual([]);
  });
});

describe("frame stepping", () => {
  it("moves one frame at a time on the frame grid, and ten with a larger step", () => {
    const f = 25;
    const a = stepFrames(0, f, 1, 10);
    expect(a).toBeCloseTo(1.5 / f, 6);
    const b = stepFrames(a, f, 1, 10);
    expect(b).toBeCloseTo(2.5 / f, 6);
    expect(stepFrames(b, f, -1, 10)).toBeCloseTo(1.5 / f, 6);
    expect(stepFrames(1, f, 10, 10)).toBeCloseTo((35.5) / f, 6);
  });
  it("stays inside the cut", () => {
    expect(stepFrames(0, 25, -1, 10)).toBeCloseTo(0.5 / 25, 6);
    expect(stepFrames(9.99, 25, 10, 10)).toBeLessThan(10);
  });
});

describe("play state (Space, J, K, L)", () => {
  it("L plays forward at 1x then 2x then 4x and stays at 4x", () => {
    let p = press(PAUSED, "l"); expect(p).toEqual({ dir: 1, rate: 1 });
    p = press(p, "l"); expect(p.rate).toBe(2);
    p = press(p, "l"); expect(p.rate).toBe(4);
    p = press(p, "l"); expect(p.rate).toBe(4);
  });
  it("J goes back at 1x, 2x, 4x; L from back starts forward at 1x; K pauses and resets", () => {
    let p = press(PAUSED, "j"); expect(p).toEqual({ dir: -1, rate: 1 });
    p = press(p, "j"); p = press(p, "j"); expect(p).toEqual({ dir: -1, rate: 4 });
    p = press(p, "l"); expect(p).toEqual({ dir: 1, rate: 1 });
    p = press(p, "l"); p = press(p, "k"); expect(p).toEqual(PAUSED);
  });
  it("Space toggles between paused and 1x forward, and pausing resets the speed", () => {
    let p = press(PAUSED, "toggle"); expect(p).toEqual({ dir: 1, rate: 1 });
    p = press({ dir: 1, rate: 4 }, "toggle"); expect(p).toEqual(PAUSED);
    expect(press({ dir: -1, rate: 2 }, "toggle")).toEqual(PAUSED);
  });
  it("labels the state for the badge", () => {
    expect(playLabel(PAUSED)).toBe("Paused");
    expect(playLabel({ dir: -1, rate: 2 })).toBe("Back 2x");
    expect(playLabel({ dir: 1, rate: 4 })).toBe("Forward 4x");
  });
});

describe("keys", () => {
  it("maps each key to its action, with Shift making a frame step ten", () => {
    expect(keyAction({ key: " " })).toEqual({ type: "play", key: "toggle" });
    expect(keyAction({ key: "k" })).toEqual({ type: "play", key: "k" });
    expect(keyAction({ key: "+", shiftKey: true })).toEqual({ type: "zoom", dir: 1 });
    expect(keyAction({ key: "=" })).toEqual({ type: "zoom", dir: 1 });
    expect(keyAction({ key: "-" })).toEqual({ type: "zoom", dir: -1 });
    expect(keyAction({ key: "0" })).toEqual({ type: "zoomFit" });
    expect(keyAction({ key: "=", ctrlKey: true })).toBeNull();      // the browser's own page zoom stays the browser's
    expect(keyAction({ key: "-", metaKey: true })).toBeNull();
    expect(keyAction({ key: "L" })).toEqual({ type: "play", key: "l" });
    expect(keyAction({ key: "ArrowLeft" })).toEqual({ type: "step", frames: -1 });
    expect(keyAction({ key: "ArrowRight", shiftKey: true })).toEqual({ type: "step", frames: 10 });
    expect(keyAction({ key: "[" })).toEqual({ type: "marker", dir: -1 });
    expect(keyAction({ key: "]" })).toEqual({ type: "marker", dir: 1 });
    expect(keyAction({ key: "?", shiftKey: true })).toEqual({ type: "help" });
    expect(keyAction({ key: "Escape" })).toEqual({ type: "close" });
    for (const [key, type] of [["Home", "home"], ["End", "end"], ["m", "mute"], ["f", "fullscreen"], ["c", "note"]] as const) expect(keyAction({ key })).toEqual({ type });
  });
  it("leaves keys alone when Ctrl, Cmd or Alt is held, and for keys it doesn't know", () => {
    expect(keyAction({ key: "k", metaKey: true })).toBeNull();
    expect(keyAction({ key: "f", ctrlKey: true })).toBeNull();
    expect(keyAction({ key: "ArrowLeft", altKey: true })).toBeNull();
    expect(keyAction({ key: "z" })).toBeNull();
  });
  it("knows when someone is typing", () => {
    expect(isTyping({ tagName: "INPUT" })).toBe(true);
    expect(isTyping({ tagName: "textarea" })).toBe(true);
    expect(isTyping({ tagName: "SELECT" })).toBe(true);
    expect(isTyping({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isTyping({ tagName: "BUTTON" })).toBe(false);
    expect(isTyping(null)).toBe(false);
  });
});

describe("speed", () => {
  it("Space plays at the speed you chose; K and Space pause; L and J still start at 1x", () => {
    expect(press(PAUSED, "toggle", 0.5)).toEqual({ dir: 1, rate: 0.5 });
    expect(press({ dir: 1, rate: 0.5 }, "toggle", 0.5)).toEqual(PAUSED);
    expect(press(PAUSED, "l", 0.5)).toEqual({ dir: 1, rate: 1 });
    expect(press(PAUSED, "j", 0.5)).toEqual({ dir: -1, rate: 1 });
    expect(press({ dir: 1, rate: 0.5 }, "l", 0.5).rate).toBe(1);   // L while playing slowly steps up the ladder
    expect(press(PAUSED, "toggle")).toEqual({ dir: 1, rate: 1 });
  });
  it("steps through the offered speeds and stops at the ends", () => {
    expect(SPEEDS).toEqual([0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]);
    expect(stepSpeed(1, 1)).toBe(1.25);
    expect(stepSpeed(1, -1)).toBe(0.75);
    expect(stepSpeed(2, 1)).toBe(2);
    expect(stepSpeed(0.25, -1)).toBe(0.25);
    expect(stepSpeed(1.1, -1)).toBe(1);   // a speed in between (from the browser's own menu) snaps sensibly
  });
  it("remembers only speeds it offers", () => {
    expect(readSpeed("1.5")).toBe(1.5);
    expect(readSpeed("3")).toBe(1);
    expect(readSpeed("abc")).toBe(1);
    expect(readSpeed(null)).toBe(1);
  });
});

describe("loop range", () => {
  it("sets an edge inside the cut, and an edge that would cross the other clears it", () => {
    let r = setEdge(NO_RANGE, "in", 30, 213);
    expect(r).toEqual({ in: 30, out: null });
    r = setEdge(r, "out", 45, 213);
    expect(r).toEqual({ in: 30, out: 45 });
    expect(setEdge(r, "in", 50, 213)).toEqual({ in: 50, out: null });      // in moved past out: out is dropped
    expect(setEdge(r, "out", 20, 213)).toEqual({ in: null, out: 20 });     // out moved before in: in is dropped
    expect(setEdge(r, "out", 30.1, 213)).toEqual({ in: null, out: 30.1 }); // too short to loop
    expect(setEdge(NO_RANGE, "out", 999, 213).out).toBe(213);
    expect(setEdge(NO_RANGE, "in", -4, 213).in).toBe(0);
  });
  it("jumps back to the start of the range when playback reaches the end, and only then", () => {
    const r = { in: 30, out: 45 };
    expect(loopJump(40, r, 213)).toBeNull();
    expect(loopJump(44.99, r, 213)).toBe(30);
    expect(loopJump(46, r, 213)).toBe(30);
    expect(loopJump(10, r, 213)).toBeNull();                 // before the range: play on until it is reached
  });
  it("treats a missing end as the start or end of the cut", () => {
    expect(loopJump(212.99, { in: 100, out: null }, 213)).toBe(100);
    expect(loopJump(5, { in: null, out: 5 }, 213)).toBe(0);
  });
  it("goes the other way when playing backwards", () => {
    const r = { in: 30, out: 45 };
    expect(loopJump(31, r, 213, -1)).toBeNull();
    expect(loopJump(30.01, r, 213, -1)).toBe(45);
    expect(loopJump(12, r, 213, -1)).toBe(45);
  });
  it("says the range in words", () => {
    expect(rangeLabel({ in: 30, out: 45 }, 213)).toBe("0:30 to 0:45");
    expect(rangeLabel({ in: 30, out: null }, 213)).toBe("0:30 to 3:33");
  });
  it("has keys: N and Shift+N step through the notes", () => {
    expect(keyAction({ key: "n" })).toEqual({ type: "noteStep", dir: 1 });
    expect(keyAction({ key: "N", shiftKey: true })).toEqual({ type: "noteStep", dir: -1 });
  });
  it("has keys: V compares and H switches which version you hear", () => {
    expect(keyAction({ key: "v" })).toEqual({ type: "compare" });
    expect(keyAction({ key: "H" })).toEqual({ type: "hear" });
    expect(keyAction({ key: "v", metaKey: true })).toBeNull();   // Cmd+V is paste
  });
  it("has keys: < > R I O X", () => {
    expect(keyAction({ key: "<", shiftKey: true })).toEqual({ type: "speed", dir: -1 });
    expect(keyAction({ key: ">", shiftKey: true })).toEqual({ type: "speed", dir: 1 });
    expect(keyAction({ key: "r" })).toEqual({ type: "loop" });
    expect(keyAction({ key: "I" })).toEqual({ type: "loopEdge", edge: "in" });
    expect(keyAction({ key: "o" })).toEqual({ type: "loopEdge", edge: "out" });
    expect(keyAction({ key: "x" })).toEqual({ type: "loopClear" });
    expect(keyAction({ key: "r", metaKey: true })).toBeNull();   // Cmd+R is the browser's reload
  });
});
