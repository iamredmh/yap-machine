import { describe, expect, it } from "vitest";
import { cropFilter, lookFrameArgs, lookMoment } from "./look-frame.js";

describe("the Look screen's clean frame", () => {
  it("picks a moment a little way in, never past the middle of a short segment", () => {
    expect(lookMoment({ start: 57.04, end: 60.56 })).toBeCloseTo(58.24, 2);
    expect(lookMoment({ start: 10, end: 10.4 })).toBeCloseTo(10.2, 2);
    expect(lookMoment({})).toBe(0);
  });
  it("crops the way the render did", () => {
    expect(cropFilter([0.37201, 0, 0.31641, 1])).toBe("crop=trunc(iw*0.31641/2)*2:trunc(ih*1.00000/2)*2:trunc(iw*0.37201):trunc(ih*0.00000)");
  });
  it("refuses a crop that isn't one", () => {
    expect(cropFilter([0.5, 0, 0.6, 1])).toBeNull();
    expect(cropFilter([0, 0, 0, 1])).toBeNull();
    expect(cropFilter([0, 0, 1] as number[])).toBeNull();
    expect(cropFilter([0, NaN, 1, 1])).toBeNull();
  });
  it("makes no frame where the picture is composited (a screen layer) or was never cropped", () => {
    expect(lookFrameArgs({ start: 1, end: 5, crop: [0, 0, 1, 1], screen: { source: "x" } }, "/a.mp4", "/o.jpg")).toBeNull();
    expect(lookFrameArgs({ start: 1, end: 5 }, "/a.mp4", "/o.jpg")).toBeNull();
  });
  it("seeks before opening the file, then crops and scales", () => {
    const a = lookFrameArgs({ start: 57.04, end: 60.56, crop: [0.37201, 0, 0.31641, 1] }, "/a.mp4", "/o.jpg")!;
    expect(a.indexOf("-ss")).toBeLessThan(a.indexOf("-i"));
    expect(a[a.indexOf("-i") + 1]).toBe("/a.mp4");
    expect(a[a.indexOf("-vf") + 1]).toMatch(/^crop=.*,scale=480:-2$/);
    expect(a.at(-1)).toBe("/o.jpg");
  });
});
