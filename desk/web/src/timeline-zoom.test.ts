import { describe, expect, it } from "vitest";
import {
  DETAIL_RATES, MIN_SPAN, TILE_PEAKS, centreOn, clampView, clockAt, dragEdge, dragWindow, edgeSpeed, follow, framePx, fullView, isFull, jumpWindow, panBy, panTo,
  keyZoom, pickLevel, pinch, rulerTicksIn, showFrameTicks, spanOf, tickStepFor, tileMax, tileSeconds, tilesFor, timeOf, wheelFactor, xOf, zoomAt, zoomLabel, zoomOf, zoomStep,
} from "./timeline-zoom.js";

const HOUR = 3600;

describe("view", () => {
  it("starts as the whole cut and knows it", () => {
    expect(fullView(213)).toEqual({ start: 0, end: 213 });
    expect(isFull(fullView(213), 213)).toBe(true);
    expect(isFull({ start: 0, end: 100 }, 213)).toBe(false);
    expect(zoomOf({ start: 0, end: 21.3 }, 213)).toBeCloseTo(10);
  });
  it("is kept inside the cut and never closer than 2 s (or the whole of a shorter cut)", () => {
    expect(clampView({ start: -5, end: 20 }, 100)).toEqual({ start: 0, end: 25 });
    expect(clampView({ start: 90, end: 130 }, 100)).toEqual({ start: 60, end: 100 });
    expect(spanOf(clampView({ start: 10, end: 10.1 }, 100))).toBe(MIN_SPAN);
    expect(clampView({ start: 0, end: 1 }, 1)).toEqual({ start: 0, end: 1 });
    expect(clampView({ start: 3, end: 900 }, 100)).toEqual({ start: 0, end: 100 });
    expect(clampView({ start: NaN, end: NaN }, 100)).toEqual({ start: 0, end: 100 });
    expect(clampView({ start: 1, end: 2 }, 0)).toEqual({ start: 0, end: 0 });
  });
});

describe("zoom", () => {
  it("keeps the moment under the pointer where it was", () => {
    const v = { start: 100, end: 200 };
    const z = zoomAt(v, 4, 150, 3600);
    expect(spanOf(z)).toBeCloseTo(25);
    expect(xOf(z, 150)).toBeCloseTo(0.5);
    const z2 = zoomAt(v, 4, 110, 3600);
    expect(xOf(z2, 110)).toBeCloseTo(0.1);
  });
  it("zooms out to the whole cut and stops there", () => {
    let v = zoomAt(fullView(200), 8, 100, 200);
    expect(spanOf(v)).toBeCloseTo(25);
    v = zoomAt(v, 1 / 100, 100, 200);
    expect(v).toEqual({ start: 0, end: 200 });
  });
  it("stops at two seconds", () => {
    const v = zoomAt(fullView(3600), 1e9, 1800, 3600);
    expect(spanOf(v)).toBe(MIN_SPAN);
    expect(v.start).toBeCloseTo(1800 - 1);
  });
  it("an anchor near the end can't push the window off it", () => {
    const v = zoomAt({ start: 0, end: 100 }, 4, 99, 100);
    expect(v.end).toBeLessThanOrEqual(100);
    expect(spanOf(v)).toBeCloseTo(25);
  });
  it("a step is 2x each way and comes back", () => {
    const a = zoomStep(fullView(600), 1, 300, 600);
    expect(spanOf(a)).toBeCloseTo(300);
    const b = zoomStep(a, -1, 300, 600);
    expect(b).toEqual({ start: 0, end: 600 });
  });
  it("a pinch on the wheel is smooth and bounded", () => {
    expect(wheelFactor(0)).toBe(1);
    expect(wheelFactor(-10)).toBeGreaterThan(1);
    expect(wheelFactor(10)).toBeLessThan(1);
    expect(wheelFactor(-10000)).toBe(wheelFactor(-60));
  });
  it("labels it", () => {
    expect(zoomLabel(fullView(100), 100)).toBe("1x");
    expect(zoomLabel({ start: 0, end: 50 }, 100)).toBe("2x");
    expect(zoomLabel({ start: 0, end: 40 }, 100)).toBe("2.5x");
    expect(zoomLabel({ start: 0, end: 2 }, 3600)).toBe("1800x");
  });
});

describe("pan", () => {
  it("moves and stops at both ends", () => {
    const v = { start: 10, end: 20 };
    expect(panBy(v, 5, 100)).toEqual({ start: 15, end: 25 });
    expect(panBy(v, -50, 100)).toEqual({ start: 0, end: 10 });
    expect(panBy(v, 500, 100)).toEqual({ start: 90, end: 100 });
    expect(panTo(v, 40, 100)).toEqual({ start: 40, end: 50 });
    expect(centreOn(v, 50, 100)).toEqual({ start: 45, end: 55 });
    expect(centreOn(v, 1, 100)).toEqual({ start: 0, end: 10 });
  });
});

describe("following the playhead", () => {
  const v = { start: 100, end: 200 };
  it("leaves a window alone when it shows the whole cut", () => {
    expect(follow(fullView(200), 150, 200, { playing: true })).toEqual(fullView(200));
  });
  it("while playing, turns the page near the right edge", () => {
    expect(follow(v, 150, 1000, { playing: true })).toBe(v);
    const next = follow(v, 195, 1000, { playing: true });
    expect(spanOf(next)).toBe(100);
    expect(xOf(next, 195)).toBeCloseTo(0.12);
  });
  it("while playing, catches a jump back or a jump far ahead", () => {
    expect(xOf(follow(v, 40, 1000, { playing: true }), 40)).toBeCloseTo(0.12);
    expect(xOf(follow(v, 700, 1000, { playing: true }), 700)).toBeCloseTo(0.12);
  });
  it("paused, only moves when the playhead is out of sight, and centres it", () => {
    expect(follow(v, 199.5, 1000, { playing: false })).toBe(v);
    const next = follow(v, 500, 1000, { playing: false });
    expect(xOf(next, 500)).toBeCloseTo(0.5);
  });
  it("never leaves the cut", () => {
    const next = follow({ start: 900, end: 1000 }, 999.9, 1000, { playing: true });
    expect(next.end).toBeLessThanOrEqual(1000);
    expect(next.start).toBeCloseTo(900);
  });
});

describe("window and time", () => {
  it("maps both ways", () => {
    const v = { start: 50, end: 70 };
    expect(xOf(v, 60)).toBe(0.5);
    expect(timeOf(v, 0.25)).toBe(55);
    expect(xOf(v, 40)).toBeLessThan(0);
    expect(xOf(v, 80)).toBeGreaterThan(1);
  });
});

describe("ruler", () => {
  it("picks a spacing that keeps labels apart, down to a twentieth of a second", () => {
    expect(tickStepFor(3600, 800)).toBe(600);
    expect(tickStepFor(3600, 1600)).toBe(300);
    expect(tickStepFor(213, 800)).toBe(30);
    expect(tickStepFor(2, 1000)).toBe(0.2);
    expect(tickStepFor(2, 150)).toBe(2);
    expect(tickStepFor(0, 100)).toBe(1);
  });
  it("labels with tenths or hundredths once the ticks are closer than a second", () => {
    expect(clockAt(75, 5)).toBe("1:15");
    expect(clockAt(75.4, 0.2)).toBe("1:15.4");
    expect(clockAt(75.45, 0.05)).toBe("1:15.45");
    expect(clockAt(3725.5, 0.5)).toBe("1:02:05.5");
    expect(clockAt(59.96, 0.1)).toBe("1:00.0");
  });
  it("lays ticks over the window, not from zero", () => {
    const t = rulerTicksIn({ start: 62, end: 66 }, 800);
    expect(t.map((k) => k.label)).toEqual(["1:02.0", "1:02.5", "1:03.0", "1:03.5", "1:04.0", "1:04.5", "1:05.0", "1:05.5", "1:06.0"]);
    expect(t[0].t).toBeGreaterThanOrEqual(62);
    expect(t[t.length - 1].t).toBeLessThanOrEqual(66);
    for (const k of t) { expect(k.x).toBeGreaterThanOrEqual(0); expect(k.x).toBeLessThanOrEqual(1); }
  });
  it("is the whole cut's ruler when the window is the whole cut", () => {
    const t = rulerTicksIn(fullView(HOUR), 1600);
    expect(t[0].label).toBe("0:00");
    expect(t[1].label).toBe("5:00");
  });
  it("can keep overview labels on whole seconds without sacrificing detail or crowding a narrow ruler", () => {
    const view = { start: 62.25, end: 66.25 };
    const overview = rulerTicksIn(view, 800, 76, 1);
    expect(overview.map(t => t.label)).toEqual(["1:03", "1:04", "1:05", "1:06"]);
    expect(overview.map(t => t.x)).toEqual([0.1875, 0.4375, 0.6875, 0.9375]);
    expect(rulerTicksIn(view, 800)[0].label).toBe("1:02.5");
    const narrow = rulerTicksIn(view, 150, 76, 1);
    expect(narrow.map(t => t.t)).toEqual([65]);
    expect(rulerTicksIn(fullView(30), 300, 76, 1).map(t => t.label)).toEqual(["0:00", "0:10", "0:20", "0:30"]);
  });
  it("draws frame ticks only when a frame is wide enough to see", () => {
    expect(framePx({ start: 0, end: 2 }, 1000, 25)).toBeCloseTo(20);
    expect(showFrameTicks(framePx({ start: 0, end: 2 }, 1000, 25))).toBe(true);
    expect(showFrameTicks(framePx({ start: 0, end: 20 }, 1000, 25))).toBe(false);
    expect(framePx({ start: 0, end: 2 }, 1000, null)).toBe(0);
  });
});

describe("waveform detail", () => {
  it("uses the overview while it has enough peaks for the bars, else the coarsest detail that does", () => {
    // 330 bars across a whole 60 s cut: 5.5 per second
    expect(pickLevel(60, 330, 5)).toBe(1);               // 5.5 a second needed, the overview has 5: the 20/s level
    expect(pickLevel(60, 250, 5)).toBe(null);
    expect(pickLevel(3600, 330, 1.1)).toBe(null);
    expect(pickLevel(600, 330, 1.1)).toBe(null);          // 0.55 a second needed, 1.1 on hand
    expect(pickLevel(100, 330, 1.1)).toBe(0);             // 3.3 a second needed: the 5/s level
  });
  it("never asks for a level that doesn't exist", () => {
    expect(pickLevel(0.5, 330, 5)).toBe(DETAIL_RATES.length - 1);
    expect(pickLevel(0, 330, 5)).toBe(null);
  });
  it("tiles last 1024 peaks", () => {
    expect(tileSeconds(0)).toBeCloseTo(TILE_PEAKS / 5);
    expect(tileSeconds(3)).toBeCloseTo(3.2);
  });
  it("lists the tiles a window touches, with a margin each side", () => {
    expect(tilesFor(3, { start: 0, end: 2 }, 3600)).toEqual([0]);
    expect(tilesFor(3, { start: 3, end: 5 }, 3600)).toEqual([0, 1]);
    expect(tilesFor(3, { start: 3, end: 5 }, 3600, 1)).toEqual([0, 1, 2]);
    expect(tilesFor(3, { start: 3.2, end: 6.4 }, 3600)).toEqual([1]);
    expect(tilesFor(3, { start: 3598, end: 3600 }, 3600, 5).at(-1)).toBe(Math.floor((3600 - 1e-9) / 3.2));
  });
  it("takes the loudest peak over a stretch, across a tile boundary, and says when a tile is missing", () => {
    const len = tileSeconds(3);
    const a = new Float32Array(TILE_PEAKS); a[TILE_PEAKS - 1] = 0.4;
    const b = new Float32Array(TILE_PEAKS); b[0] = 0.9; b[1] = 0.2;
    const tiles = new Map<number, Float32Array>([[0, a], [1, b]]);
    expect(tileMax(3, tiles, len - 0.01, len + 0.002)).toBeCloseTo(0.9);
    expect(tileMax(3, tiles, len - 0.01, len)).toBeCloseTo(0.4);
    expect(tileMax(3, tiles, 2 * len + 0.1, 2 * len + 0.2)).toBeNull();
    expect(tileMax(3, tiles, 0, 0)).toBe(0);
  });
});

describe("minimap", () => {
  it("drags the window by a share of the cut", () => {
    expect(dragWindow({ start: 100, end: 200 }, 0.1, 1000)).toEqual({ start: 200, end: 300 });
    expect(dragWindow({ start: 100, end: 200 }, -0.5, 1000)).toEqual({ start: 0, end: 100 });
  });
  it("resizes from either edge, keeping two seconds", () => {
    expect(dragEdge({ start: 100, end: 200 }, "start", 150, 1000)).toEqual({ start: 150, end: 200 });
    expect(dragEdge({ start: 100, end: 200 }, "start", 199.9, 1000)).toEqual({ start: 198, end: 200 });
    expect(dragEdge({ start: 100, end: 200 }, "end", 100.1, 1000)).toEqual({ start: 100, end: 102 });
    expect(dragEdge({ start: 100, end: 200 }, "end", 5000, 1000)).toEqual({ start: 100, end: 1000 });
  });
  it("jumps the window to a click", () => {
    expect(jumpWindow({ start: 0, end: 100 }, 500, 1000)).toEqual({ start: 450, end: 550 });
  });
});

describe("touch", () => {
  it("zooms by how far two fingers moved apart, about their middle", () => {
    const r = pinch({ a: 100, b: 200 }, { a: 50, b: 250 });
    expect(r.factor).toBe(2);
    expect(r.centre).toBe(150);
    expect(r.move).toBe(0);
    expect(pinch({ a: 100, b: 102 }, { a: 50, b: 250 }).factor).toBe(1);
    expect(pinch({ a: 100, b: 200 }, { a: 120, b: 220 }).move).toBe(20);
  });
  it("auto-pans only when a scrub is held near an edge", () => {
    expect(edgeSpeed(400, 800, 10)).toBe(0);
    expect(edgeSpeed(0, 800, 10)).toBe(-10);
    expect(edgeSpeed(800, 800, 10)).toBe(10);
    expect(edgeSpeed(14, 800, 10)).toBeCloseTo(-5);
    expect(edgeSpeed(5, 0, 10)).toBe(0);
  });
});

describe("zoom keys and buttons", () => {
  it("zoom about the playhead when it is on screen, else about the middle, and 0 shows it all", () => {
    const v = { start: 100, end: 200 };
    const a = keyZoom(v, "in", 120, 1000);
    expect(spanOf(a)).toBe(50);
    expect(xOf(a, 120)).toBeCloseTo(0.2);
    const b = keyZoom(v, "in", 900, 1000);
    expect(xOf(b, 150)).toBeCloseTo(0.5);
    expect(keyZoom(a, "fit", 120, 1000)).toEqual({ start: 0, end: 1000 });
    expect(keyZoom(fullView(1000), "out", 5, 1000)).toEqual({ start: 0, end: 1000 });
  });
});
