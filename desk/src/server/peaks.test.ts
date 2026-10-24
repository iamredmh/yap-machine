import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DETAIL_RATES as WEB_RATES, TILE_PEAKS as WEB_TILE_PEAKS } from "../../web/src/timeline-zoom.js";
import { DETAIL_RATES, PEAK_RATE, PeakReducer, PeaksCache, TILE_PEAKS, peakBuckets, peaksKey, peaksTimeoutMs, tileArgs, tileSeconds } from "./peaks.js";

const haveFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

const floats = (xs: number[]) => { const b = Buffer.alloc(xs.length * 4); xs.forEach((x, i) => b.writeFloatLE(x, i * 4)); return b; };

describe("PeakReducer", () => {
  it("keeps the loud part loud, the quiet part at zero, and the loudest peak at 1", () => {
    const r = new PeakReducer(100);
    r.push(floats(Array.from({ length: PEAK_RATE }, (_, i) => 0.4 * Math.sin(i / 7))));
    r.push(floats(new Array(PEAK_RATE).fill(0)));
    const out = r.finish();
    expect(out.peaks.length).toBe(100);
    expect(out.duration).toBeCloseTo(2, 3);
    expect(Math.max(...out.peaks)).toBe(1);
    expect(out.peaks.slice(0, 45).every((p) => p > 0.5)).toBe(true);
    expect(out.peaks.slice(55).every((p) => p === 0)).toBe(true);
  });

  it("copes with a float split across two chunks and with a stream far longer than its buckets", () => {
    const xs = Array.from({ length: 20_000 }, (_, i) => (i % 1000 < 5 ? 0.9 : 0.01));
    const whole = new PeakReducer(50); whole.push(floats(xs));
    const split = new PeakReducer(50); const b = floats(xs); split.push(b.subarray(0, 7)); split.push(b.subarray(7, 33_333)); split.push(b.subarray(33_333));
    expect(split.finish()).toEqual(whole.finish());
  });

  it("gives all zeros for silence, not NaN", () => {
    const r = new PeakReducer(10); r.push(floats(new Array(1000).fill(0)));
    expect(r.finish().peaks.every((p) => p === 0)).toBe(true);
  });
});

describe("detail tiles: the reducer and the numbers", () => {
  it("scales by a given gain instead of its own loudest peak, and never goes above 1", () => {
    const r = new PeakReducer(4);
    r.push(floats([0.1, 0.1, 0.2, 0.2, 0.4, 0.4, 0.8, 0.8]));
    const own = r.finish();
    expect(own.max).toBeCloseTo(0.8);
    expect(own.peaks).toEqual([0.125, 0.25, 0.5, 1]);
    const r2 = new PeakReducer(4);
    r2.push(floats([0.1, 0.1, 0.2, 0.2, 0.4, 0.4, 0.8, 0.8]));
    expect(r2.finish(1.6).peaks).toEqual([0.063, 0.125, 0.25, 0.5]);
    const r3 = new PeakReducer(2);
    r3.push(floats([0.5, 0.5, 0.9, 0.9]));
    expect(r3.finish(0.6).peaks).toEqual([0.833, 1]);
  });
  it("counts silence past the end of the audio", () => {
    const r = new PeakReducer(4);
    r.push(floats([1, 1]));
    r.pad(6);
    expect(r.finish(1).peaks).toEqual([1, 0, 0, 0]);
  });
  it("uses the same levels and tile size as the timeline in the browser", () => {
    expect(DETAIL_RATES).toEqual(WEB_RATES);
    expect(TILE_PEAKS).toBe(WEB_TILE_PEAKS);
    expect(tileSeconds(3)).toBeCloseTo(3.2);
  });
  it("asks ffmpeg to seek before it opens the file, which is what makes a window of an hour-long cut quick", () => {
    const a = tileArgs("/w/p/renders/v1.mp4", 1800, 3.2);
    expect(a.indexOf("-ss")).toBeLessThan(a.indexOf("-i"));
    expect(a[a.indexOf("-ss") + 1]).toBe("1800.000");
    expect(a[a.indexOf("-t") + 1]).toBe("3.200");
  });
});

describe("cache key and sizes", () => {
  it("changes with the file's size, its modified time and the peak count, and nothing else", () => {
    const k = peaksKey("/w/p/renders/v5.mp4", 1000, 1_700_000_000_000.4, 1065);
    expect(peaksKey("/w/p/renders/v5.mp4", 1000, 1_700_000_000_000.4, 1065)).toBe(k);
    expect(peaksKey("/w/p/renders/v5.mp4", 1001, 1_700_000_000_000.4, 1065)).not.toBe(k);
    expect(peaksKey("/w/p/renders/v5.mp4", 1000, 1_700_000_005_000, 1065)).not.toBe(k);
    expect(peaksKey("/w/p/renders/v5.mp4", 1000, 1_700_000_000_000.4, 4000)).not.toBe(k);
    expect(k).toMatch(/^[0-9a-f]{16}$/);
  });
  it("scales the peak count with the cut, between 1000 and 4000", () => {
    expect(peakBuckets(10)).toBe(1000);
    expect(peakBuckets(213.84)).toBe(1070);
    expect(peakBuckets(3600)).toBe(4000);
  });
  it("gives a long decode longer, within bounds", () => {
    expect(peaksTimeoutMs(0)).toBe(120_000);
    expect(peaksTimeoutMs(5e10)).toBe(30 * 60_000);
  });
});

describe.skipIf(!haveFfmpeg)("PeaksCache with ffmpeg", () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "yap-peaks-")); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  const sine = (out: string) => spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "aevalsrc='if(lt(t,1),0.8*sin(2*PI*440*t),0)':d=2:s=8000", out]);

  it("makes peaks on the first ask, serves them after, and remakes them when the render changes", async () => {
    const wav = join(dir, "v1.mp4.wav");
    expect(sine(wav).status).toBe(0);
    const cache = new PeaksCache(join(dir, ".yap-desk"));
    expect((await cache.get(wav, "p", "v1", 2)).state).toBe("computing");
    await cache.idle();
    const a = await cache.get(wav, "p", "v1", 2);
    if (a.state !== "ready") throw new Error(`expected ready, got ${a.state}`);
    expect(a.data.duration).toBeGreaterThan(1.9);
    expect(a.data.duration).toBeLessThan(2.1);
    const n = a.data.peaks.length;
    expect(a.data.peaks.slice(0, Math.floor(n * 0.4)).every((p) => p > 0.5)).toBe(true);
    expect(a.data.peaks.slice(Math.ceil(n * 0.6)).every((p) => p < 0.05)).toBe(true);
    const first = a.data.key;

    // the same file touched again is a new render: new key, new decode, the old file gone
    const later = new Date(Date.now() + 60_000);
    await utimes(wav, later, later);
    expect((await cache.get(wav, "p", "v1", 2)).state).toBe("computing");
    await cache.idle();
    const b = await cache.get(wav, "p", "v1", 2);
    if (b.state !== "ready") throw new Error("expected ready after the re-render");
    expect(b.data.key).not.toBe(first);
    expect((await readdir(join(dir, ".yap-desk", "peaks"))).filter((f) => f.endsWith(".json"))).toHaveLength(1);
  });

  it("says silent for a cut with no audio, and missing for a cut that isn't rendered", async () => {
    const mute = join(dir, "v2.mp4");
    expect(spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=64x64:d=1", "-an", mute]).status).toBe(0);
    const cache = new PeaksCache(join(dir, ".yap-desk"));
    expect((await cache.get(mute, "p", "v2", 1)).state).toBe("computing");
    await cache.idle();
    expect((await cache.get(mute, "p", "v2", 1)).state).toBe("silent");
    expect((await cache.get(join(dir, "nope.mp4"), "p", "v3", 1)).state).toBe("missing");
  });

  it("reports a file ffmpeg can't read as failed, not as silent", async () => {
    const junk = join(dir, "v4.mp4");
    await writeFile(junk, "this is not a video");
    const cache = new PeaksCache(join(dir, ".yap-desk"));
    await cache.get(junk, "p", "v4", 1);
    await cache.idle();
    expect((await cache.get(junk, "p", "v4", 1)).state).toBe("failed");
  });
});

describe.skipIf(!haveFfmpeg)("detail tiles with ffmpeg", () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "yap-tiles-")); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  // 1 s of a loud tone, then 1 s at a quarter of the level, then 2 s of nothing: 4 s in all
  const tone = (out: string) => spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "aevalsrc='if(lt(t,1),0.8*sin(2*PI*440*t),if(lt(t,2),0.2*sin(2*PI*440*t),0))':d=4:s=8000", out]);

  it("waits for the overview, then makes a tile whose loud and quiet parts sit where they should and keep the overview's scale", async () => {
    const wav = join(dir, "v1.wav");
    expect(tone(wav).status).toBe(0);
    const cache = new PeaksCache(join(dir, ".yap-desk"));
    expect((await cache.tile(wav, "p", "v1", 4, 3, 0)).state).toBe("computing");
    await cache.idle();
    const ov = await cache.get(wav, "p", "v1", 4);
    if (ov.state !== "ready") throw new Error("overview not ready");
    const a = await cache.tile(wav, "p", "v1", 4, 3, 0);
    if (a.state !== "ready") throw new Error(`expected a tile, got ${a.state}`);
    expect(a.data.peaks).toHaveLength(TILE_PEAKS);
    expect(a.data.rate).toBe(320);
    const at = (s: number) => a.data.peaks[Math.floor(s * 320)];
    expect(Math.max(...a.data.peaks.slice(0, 300))).toBeCloseTo(1, 1);          // the first second is the loudest in the cut
    expect(Math.max(...a.data.peaks.slice(330, 630))).toBeGreaterThan(0.2);     // the next second is a quarter of it
    expect(Math.max(...a.data.peaks.slice(330, 630))).toBeLessThan(0.35);
    expect(at(2.5)).toBe(0);
    expect(at(3.1)).toBe(0);
    // an edge is where the tone stops: within 25 ms
    let lastLoud = 0;
    for (let i = 0; i < 400; i++) if (a.data.peaks[i] > 0.5) lastLoud = i;
    expect(Math.abs(lastLoud / 320 - 1)).toBeLessThan(0.025);
  });

  it("gives the second tile its own stretch, zero-padded where the audio ends, and refuses one far past the end", async () => {
    const wav = join(dir, "v1.wav");
    expect(tone(wav).status).toBe(0);
    const cache = new PeaksCache(join(dir, ".yap-desk"));
    await cache.get(wav, "p", "v1", 4); await cache.idle();
    const b = await cache.tile(wav, "p", "v1", 4, 3, 1);          // 3.2 .. 6.4 s: the audio ends at 4
    if (b.state !== "ready") throw new Error(`expected a tile, got ${b.state}`);
    expect(b.data.peaks.every((p) => p === 0)).toBe(true);
    expect((await cache.tile(wav, "p", "v1", 4, 3, 9)).state).toBe("range");
    expect((await cache.tile(wav, "p", "v1", 4, 7, 0)).state).toBe("range");
    expect((await cache.tile(wav, "p", "v1", 4, 1, -1)).state).toBe("range");
  });

  it("serves a tile it has made from disk, and drops the tiles of an older render when the file is replaced", async () => {
    const wav = join(dir, "v1.wav");
    expect(tone(wav).status).toBe(0);
    const cache = new PeaksCache(join(dir, ".yap-desk"));
    await cache.get(wav, "p", "v1", 4); await cache.idle();
    await cache.tile(wav, "p", "v1", 4, 2, 0);
    const root = join(dir, ".yap-desk", "peaks", "tiles");
    const first = await readdir(root);
    expect(first).toHaveLength(1);
    expect(await readdir(join(root, first[0]))).toEqual(["L2-0.json"]);
    const again = await cache.tile(wav, "p", "v1", 4, 2, 0);
    expect(again.state).toBe("ready");

    const later = new Date(Date.now() + 60_000);
    await utimes(wav, later, later);
    expect((await cache.tile(wav, "p", "v1", 4, 2, 0)).state).toBe("computing");     // the overview is made again first
    await cache.idle();
    const fresh = await cache.tile(wav, "p", "v1", 4, 2, 0);
    expect(fresh.state).toBe("ready");
    const second = await readdir(root);
    expect(second).toHaveLength(1);
    expect(second[0]).not.toBe(first[0]);
  });

  it("says silent for a cut with no audio, and failed for a file it can't read", async () => {
    const mute = join(dir, "v2.mp4");
    expect(spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=64x64:d=1", "-an", mute]).status).toBe(0);
    const cache = new PeaksCache(join(dir, ".yap-desk"));
    await cache.get(mute, "p", "v2", 1); await cache.idle();
    expect((await cache.tile(mute, "p", "v2", 1, 0, 0)).state).toBe("silent");
    const junk = join(dir, "v4.mp4");
    await writeFile(junk, "this is not a video");
    await cache.get(junk, "p", "v4", 1); await cache.idle();
    expect((await cache.tile(junk, "p", "v4", 1, 0, 0)).state).toBe("failed");
    expect((await cache.tile(join(dir, "nope.mp4"), "p", "v5", 1, 0, 0)).state).toBe("missing");
  });

  it("makes two tiles at once without making either twice", async () => {
    const wav = join(dir, "v1.wav");
    expect(tone(wav).status).toBe(0);
    const cache = new PeaksCache(join(dir, ".yap-desk"));
    await cache.get(wav, "p", "v1", 4); await cache.idle();
    const [x, y, z] = await Promise.all([cache.tile(wav, "p", "v1", 4, 3, 0), cache.tile(wav, "p", "v1", 4, 3, 0), cache.tile(wav, "p", "v1", 4, 3, 1)]);
    expect([x.state, y.state, z.state]).toEqual(["ready", "ready", "ready"]);
    expect(x).toEqual(y);
  });
});
