import { describe, expect, it } from "vitest";
import { classifyPeaks, classifyTile, peaksCacheKey, peaksUrl, tileKey, tileUrl } from "./peaks.js";

describe("peaks client", () => {
  it("keys the answer by project, version and the render's revision, so a re-render asks again", () => {
    expect(peaksCacheKey("t2", "v5", "100-1")).toBe("t2/v5/100-1");
    expect(peaksCacheKey("t2", "v5", "100-2")).not.toBe(peaksCacheKey("t2", "v5", "100-1"));
    expect(peaksUrl("t 2", "v2.s1", "9-8")).toBe("/api/projects/t%202/versions/v2.s1/peaks?rev=9-8");
  });
  it("reads each status: 202 wait, 204 silent, 404 unrendered, 200 a wave", () => {
    expect(classifyPeaks(202, { state: "computing" })).toBe("pending");
    expect(classifyPeaks(204, null)).toEqual({ kind: "silent" });
    expect(classifyPeaks(404, {})).toEqual({ kind: "unrendered" });
    const w = classifyPeaks(200, { duration: 2, peaks: [0, 0.5, 1] });
    expect(w).toMatchObject({ kind: "wave", wave: { duration: 2 } });
    if (typeof w !== "string" && w.kind === "wave") expect(Array.from(w.wave.peaks)).toEqual([0, 0.5, 1]);
  });
  it("turns a broken 200 or a server error into a message, not a blank", () => {
    expect(classifyPeaks(200, { duration: 0, peaks: [] })).toMatchObject({ kind: "error" });
    expect(classifyPeaks(200, { duration: 2, peaks: [0, "x"] })).toMatchObject({ kind: "error" });
    expect(classifyPeaks(500, { message: "Couldn't read this cut's audio: x" })).toEqual({ kind: "error", message: "Couldn't read this cut's audio: x" });
    expect(classifyPeaks(501, {})).toMatchObject({ kind: "error" });
  });
  it("asks for a tile by level and index, and keys it by the render's revision too", () => {
    expect(tileUrl("t 2", "v2.s1", "9-8", 3, 12)).toBe("/api/projects/t%202/versions/v2.s1/peaks/tile?level=3&i=12&rev=9-8");
    expect(tileKey("t2", "v5", "100-1", 2, 7)).toBe("t2/v5/100-1/2/7");
    expect(tileKey("t2", "v5", "100-2", 2, 7)).not.toBe(tileKey("t2", "v5", "100-1", 2, 7));
  });
  it("reads a tile response: peaks, wait, or none", () => {
    expect(classifyTile(202, {})).toBe("pending");
    expect(classifyTile(204, null)).toBeNull();
    expect(classifyTile(404, {})).toBeNull();
    expect(classifyTile(500, {})).toBeNull();
    expect(classifyTile(200, { peaks: [] })).toBeNull();
    expect(classifyTile(200, { peaks: [0, "x"] })).toBeNull();
    const t = classifyTile(200, { peaks: [0, 0.5, 1] });
    expect(t).toBeInstanceOf(Float32Array);
    expect(Array.from(t as Float32Array)).toEqual([0, 0.5, 1]);
  });
});
