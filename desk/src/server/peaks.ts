import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The waveform under the review timeline. ffmpeg decodes the render's audio mono at 8 kHz and the
 * server reduces it to a few thousand peaks while it streams, so an hour-long cut never sits in
 * memory. The result is a small JSON file in .yap-desk/peaks/, named for the render's path, size
 * and modified time, so a re-render is never shown the old waveform. The idea and the reducer come
 * from Rushes (src/server/peaks.ts); the job queue does not: one on-demand decode per file is enough.
 */

/** The sample rate ffmpeg resamples to: plenty for an outline, quick to decode. */
export const PEAK_RATE = 8000;
export const PEAKS_DIR = "peaks";
/** A peaks file is at most this big; anything larger isn't read. */
const PEAKS_MAX_BYTES = 256 * 1024;
const NO_AUDIO = /does not contain any stream|matches no streams|no audio/i;

/** About five peaks a second, between 1000 and 4000, so a short stays crisp and an hour is still light. */
export function peakBuckets(duration: number): number {
  return Math.min(4000, Math.max(1000, Math.ceil((duration || 0) / 0.2)));
}

/** A decode of this size may run for at most this long: a minute plus the file read at 5 MB/s, held to 2-30 minutes. */
export function peaksTimeoutMs(bytes: number): number {
  const ms = 60_000 + (Math.max(0, bytes) / 5e6) * 1000;
  return Math.round(Math.min(30 * 60_000, Math.max(2 * 60_000, ms)));
}

/** ffmpeg's arguments: first audio stream if there is one, padded with silence from 0:00, mono, 8 kHz, raw f32 on stdout. */
export function peaksArgs(abs: string): string[] {
  return [
    "-hide_banner", "-nostdin", "-v", "error",
    "-protocol_whitelist", "file,pipe",
    "-i", abs,
    "-map", "0:a:0?", "-vn", "-sn", "-dn",
    "-af", "aresample=async=1:first_pts=0",
    "-ac", "1", "-ar", String(PEAK_RATE), "-f", "f32le", "pipe:1",
  ];
}

/** Blocks held per bucket. Finer than Rushes (2): a tightly edited cut has 0.2 s pauses, and a block 0.13 s wide smears them. */
const BLOCKS_PER_BUCKET = 8;
/** Bump when the reduction changes, so an older waveform on disk is made again. */
const PEAKS_ALGO = 3;

/**
 * Reduces a stream of f32le samples to at most `buckets` peaks (the largest absolute amplitude in
 * each) without knowing the length up front. Samples go into blocks; when 8 x `buckets` blocks are
 * full, neighbouring pairs merge and the block size doubles, so memory stays fixed however long the film.
 */
export class PeakReducer {
  private readonly cap: number;
  private readonly blocks: Float64Array;
  private count = 0;
  private blockSize = 1;
  private inBlock = 0;
  private current = 0;
  private carry: Buffer | null = null;
  private samples = 0;

  constructor(readonly buckets: number, readonly rate = PEAK_RATE) {
    this.cap = Math.max(2, buckets * BLOCKS_PER_BUCKET);
    this.blocks = new Float64Array(this.cap);
  }

  push(chunk: Buffer): void {
    let buf = chunk;
    if (this.carry) { buf = Buffer.concat([this.carry, chunk]); this.carry = null; }
    const whole = buf.length - (buf.length % 4);
    for (let o = 0; o < whole; o += 4) this.sample(buf.readFloatLE(o));
    if (whole < buf.length) this.carry = Buffer.from(buf.subarray(whole));
  }

  private sample(v: number): void {
    const a = Number.isFinite(v) ? Math.abs(v) : 0;
    if (a > this.current) this.current = a;
    this.samples++;
    if (++this.inBlock === this.blockSize) this.close();
  }

  private close(): void {
    this.blocks[this.count++] = this.current;
    this.current = 0;
    this.inBlock = 0;
    if (this.count === this.cap) {
      for (let i = 0; i < this.cap / 2; i++) this.blocks[i] = Math.max(this.blocks[2 * i], this.blocks[2 * i + 1]);
      this.count = this.cap / 2;
      this.blockSize *= 2;
    }
  }

  /** Counts `n` more samples of silence, for a window that runs past the end of the audio. */
  pad(n: number): void {
    for (let i = 0; i < n; i++) this.sample(0);
  }

  get seen(): number { return this.samples; }

  /**
   * The peaks, normalised so the loudest is 1 and rounded to 3 decimals; silence is all zeros.
   * With `gain` (the whole cut's loudest sample) they are scaled by that instead, so a stretch cut out of the cut keeps its height.
   */
  finish(gain?: number): { peaks: number[]; samples: number; duration: number; max: number } {
    if (this.inBlock > 0) this.close();
    const total = this.samples;
    const n = Math.min(this.buckets, this.count);
    const raw = new Array<number>(n).fill(0);
    const size = this.blockSize;
    for (let i = 0; i < n; i++) {
      const from = (i * total) / n;
      const to = ((i + 1) * total) / n;
      let a = Math.ceil(from / size);
      let b = Math.min(this.count, Math.ceil(to / size));
      if (b <= a) { a = Math.min(this.count - 1, Math.floor(from / size)); b = a + 1; }
      let peak = 0;
      for (let k = a; k < b; k++) if (this.blocks[k] > peak) peak = this.blocks[k];
      raw[i] = peak;
    }
    const max = raw.reduce((m, p) => (p > m ? p : m), 0);
    const scale = gain !== undefined ? gain : max;
    const peaks = raw.map((p) => (scale > 0 ? Math.min(1, Math.round((p / scale) * 1000) / 1000) : 0));
    return { peaks, samples: total, duration: Math.round((total / this.rate) * 1000) / 1000, max };
  }
}

/** A revision of a render: its path, size, modified time and the peak count, as a short hash. A re-render changes it. */
export function peaksKey(file: string, size: number, mtimeMs: number, buckets: number): string {
  return createHash("sha256").update(`${PEAKS_ALGO}\0${file}\0${size}\0${Math.round(mtimeMs)}\0${buckets}`).digest("hex").slice(0, 16);
}

export type PeaksFile = { v: 1; key: string; buckets: number; duration: number; max: number; peaks: number[] } | { v: 1; key: string; audio: false };
export type PeaksAnswer =
  | { state: "ready"; data: Extract<PeaksFile, { peaks: number[] }> }
  | { state: "computing" }
  | { state: "silent" }
  | { state: "missing" }
  | { state: "failed"; reason: string; noFfmpeg?: boolean };

/** Decodes a file's audio and reduces it. Resolves `audio: false` when the file has no audio stream; rejects when ffmpeg can't read it. */
export function decodePeaks(abs: string, buckets: number, timeoutMs: number): Promise<{ peaks: number[]; duration: number; max: number } | null> {
  return new Promise((ok, fail) => {
    const reducer = new PeakReducer(buckets);
    let err = "";
    let child;
    try { child = spawn("ffmpeg", peaksArgs(abs), { stdio: ["ignore", "pipe", "pipe"] }); }
    catch (e) { fail(Object.assign(new Error(String(e)), { noFfmpeg: true })); return; }
    const timer = setTimeout(() => { child.kill("SIGKILL"); fail(new Error("Reading the audio took too long")); }, timeoutMs);
    child.stdout.on("data", (b: Buffer) => reducer.push(b));
    child.stderr.on("data", (b: Buffer) => { if (err.length < 4000) err += b.toString(); });
    child.on("error", (e) => { clearTimeout(timer); fail(Object.assign(new Error(e.message), { noFfmpeg: (e as NodeJS.ErrnoException).code === "ENOENT" })); });
    child.on("close", (code) => {
      clearTimeout(timer);
      const r = reducer.finish();
      const why = () => new Error(err.trim().split("\n").pop() || `ffmpeg stopped (${code})`);
      if (r.samples === 0) { if (NO_AUDIO.test(err) || code === 0) ok(null); else fail(why()); return; }
      if (code !== 0) { fail(why()); return; }
      ok({ peaks: r.peaks, duration: r.duration, max: r.max });
    });
  });
}

// ---- detail tiles: the waveform of a stretch of the cut, finer than the overview, for when the timeline is zoomed in ----------------

/** Peaks a second at each detail level and peaks in a tile: the same numbers as web/src/timeline-zoom.ts (a test holds them together). */
export const DETAIL_RATES = [5, 20, 80, 320];
export const TILE_PEAKS = 1024;
export const tileSeconds = (level: number) => TILE_PEAKS / DETAIL_RATES[level];
const TILES_DIR = "tiles";
/** At most this many tiles kept per render; the oldest go first. A fully viewed hour at the finest level is about 1100. */
const TILES_KEEP = 2500;
/** At most this many tile decodes at once, so a long pan doesn't start dozens of ffmpegs. */
const TILE_JOBS = 3;
const TILE_TIMEOUT_MS = 30_000;

/** ffmpeg's arguments for a window of the audio: seek first (fast on a long file), then the same mono 8 kHz float stream as the overview. */
export function tileArgs(abs: string, start: number, length: number): string[] {
  return [
    "-hide_banner", "-nostdin", "-v", "error",
    "-protocol_whitelist", "file,pipe",
    "-ss", start.toFixed(3), "-t", length.toFixed(3),
    "-i", abs,
    "-map", "0:a:0?", "-vn", "-sn", "-dn",
    "-af", "aresample=async=1:first_pts=0",
    "-ac", "1", "-ar", String(PEAK_RATE), "-f", "f32le", "pipe:1",
  ];
}

/** Decodes one window and reduces it to TILE_PEAKS peaks, scaled by the whole cut's loudest sample. Past the end of the audio is silence. */
export function decodeTile(abs: string, start: number, length: number, gain: number, timeoutMs = TILE_TIMEOUT_MS): Promise<number[]> {
  return new Promise((ok, fail) => {
    const reducer = new PeakReducer(TILE_PEAKS);
    let err = "";
    let child;
    try { child = spawn("ffmpeg", tileArgs(abs, start, length), { stdio: ["ignore", "pipe", "pipe"] }); }
    catch (e) { fail(Object.assign(new Error(String(e)), { noFfmpeg: true })); return; }
    const timer = setTimeout(() => { child.kill("SIGKILL"); fail(new Error("Reading the audio took too long")); }, timeoutMs);
    child.stdout.on("data", (b: Buffer) => reducer.push(b));
    child.stderr.on("data", (b: Buffer) => { if (err.length < 4000) err += b.toString(); });
    child.on("error", (e) => { clearTimeout(timer); fail(Object.assign(new Error(e.message), { noFfmpeg: (e as NodeJS.ErrnoException).code === "ENOENT" })); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 && reducer.seen === 0) { fail(new Error(err.trim().split("\n").pop() || `ffmpeg stopped (${code})`)); return; }
      const want = Math.round(length * PEAK_RATE);
      if (reducer.seen < want) reducer.pad(want - reducer.seen);
      ok(reducer.finish(gain).peaks);
    });
  });
}

export interface TileFile { v: 1; key: string; level: number; index: number; rate: number; peaks: number[] }
export type TileAnswer =
  | { state: "ready"; data: TileFile }
  | { state: "computing" } | { state: "silent" } | { state: "missing" } | { state: "range" }
  | { state: "failed"; reason: string; noFfmpeg?: boolean };

/** The desk's waveform cache: .yap-desk/peaks/<project>__<version>__<key>.json, one decode at a time per render. */
export class PeaksCache {
  private running = new Map<string, Promise<void>>();
  private failed = new Map<string, { reason: string; noFfmpeg?: boolean }>();
  private tiles = new Map<string, Promise<TileAnswer>>();
  private tileWaiting: (() => void)[] = [];
  private tileActive = 0;
  private tileWrites = 0;

  constructor(private readonly dir: string) {}

  /** Where a render's peaks live, or null when the render isn't there yet. */
  async locate(abs: string, project: string, version: string, duration: number) {
    let st;
    try { st = await stat(abs); } catch { return null; }
    const buckets = peakBuckets(duration);
    const key = peaksKey(abs, st.size, st.mtimeMs, buckets);
    return { key, buckets, size: st.size, file: join(this.dir, PEAKS_DIR, `${project}__${version}__${key}.json`), prefix: `${project}__${version}__` };
  }

  async get(abs: string, project: string, version: string, duration: number): Promise<PeaksAnswer> {
    const at = await this.locate(abs, project, version, duration);
    if (!at) return { state: "missing" };
    const cached = await this.read(at.file);
    if (cached) return "audio" in cached ? { state: "silent" } : { state: "ready", data: cached };
    const fail = this.failed.get(at.key);
    if (fail) return { state: "failed", ...fail };
    if (!this.running.has(at.key)) {
      const job = this.make(abs, at).finally(() => this.running.delete(at.key));
      this.running.set(at.key, job);
    }
    return { state: "computing" };
  }

  /**
   * One tile of detail: peaks for tileSeconds(level) of the cut starting at index x that long. Needs the overview first (for the cut's
   * length and loudest sample), so it answers "computing" until that is done. Tiles live in tiles/<project>__<version>__<render key>/,
   * so a re-render never serves an old one, and the folders of older renders are removed on the first write for a new one.
   */
  async tile(abs: string, project: string, version: string, duration: number, level: number, index: number): Promise<TileAnswer> {
    if (!Number.isInteger(level) || level < 0 || level >= DETAIL_RATES.length || !Number.isInteger(index) || index < 0) return { state: "range" };
    const ov = await this.get(abs, project, version, duration);
    if (ov.state === "failed") return ov;
    if (ov.state !== "ready") return { state: ov.state };
    const len = tileSeconds(level);
    if (index * len >= ov.data.duration + 1) return { state: "range" };
    const name = `${project}__${version}__${ov.data.key}`;
    const file = join(this.dir, PEAKS_DIR, TILES_DIR, name, `L${level}-${index}.json`);
    try {
      const j = JSON.parse(await readFile(file, "utf8"));
      if (j?.v === 1 && Array.isArray(j.peaks) && j.peaks.length === TILE_PEAKS) return { state: "ready", data: j as TileFile };
    } catch { /* not made yet */ }
    let job = this.tiles.get(file);
    if (!job) {
      job = this.makeTile(abs, project, version, ov.data, name, file, level, index).finally(() => this.tiles.delete(file));
      this.tiles.set(file, job);
    }
    return job;
  }

  private async slot(): Promise<() => void> {
    if (this.tileActive >= TILE_JOBS) await new Promise<void>((go) => this.tileWaiting.push(go));
    this.tileActive++;
    return () => { this.tileActive--; this.tileWaiting.shift()?.(); };
  }

  private async makeTile(abs: string, project: string, version: string, ov: Extract<PeaksFile, { peaks: number[] }>, name: string, file: string, level: number, index: number): Promise<TileAnswer> {
    const release = await this.slot();
    try {
      const len = tileSeconds(level);
      const peaks = await decodeTile(abs, index * len, len, ov.max);
      // the render may have been replaced while this ran: then these peaks belong to a file that is gone
      const now = await this.locate(abs, project, version, ov.duration);
      if (!now || now.key !== ov.key) return { state: "computing" };
      const data: TileFile = { v: 1, key: ov.key, level, index, rate: DETAIL_RATES[level], peaks };
      const dir = join(this.dir, PEAKS_DIR, TILES_DIR, name);
      await mkdir(dir, { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(data));
      await rename(tmp, file);
      await this.tidyTiles(project, version, name, dir);
      return { state: "ready", data };
    } catch (e) {
      return { state: "failed", reason: (e as Error).message, noFfmpeg: (e as { noFfmpeg?: boolean }).noFfmpeg };
    } finally { release(); }
  }

  /** Removes the tile folders of older renders of this version, and the oldest tiles once a render has more than TILES_KEEP. */
  private async tidyTiles(project: string, version: string, name: string, dir: string): Promise<void> {
    const root = join(this.dir, PEAKS_DIR, TILES_DIR);
    const prefix = `${project}__${version}__`;
    for (const f of await readdir(root).catch(() => [] as string[])) if (f.startsWith(prefix) && f !== name) await rm(join(root, f), { recursive: true, force: true });
    if (++this.tileWrites % 64 !== 0) return;
    const files = await readdir(dir).catch(() => [] as string[]);
    if (files.length <= TILES_KEEP) return;
    const aged = await Promise.all(files.map(async (f) => ({ f, t: (await stat(join(dir, f)).catch(() => null))?.mtimeMs ?? 0 })));
    aged.sort((a, b) => a.t - b.t);
    for (const { f } of aged.slice(0, files.length - TILES_KEEP + 500)) await rm(join(dir, f), { force: true });
  }

  /** Resolves when the decode for a render has finished (for tests and for a caller that wants to wait). */
  idle(): Promise<unknown> { return Promise.all([...this.running.values()]); }

  private async read(file: string): Promise<PeaksFile | null> {
    try {
      if ((await stat(file)).size > PEAKS_MAX_BYTES) return null;
      const j = JSON.parse(await readFile(file, "utf8"));
      if (j?.v !== 1) return null;
      if (j.audio === false) return j as PeaksFile;
      if (!Array.isArray(j.peaks) || !j.peaks.every((p: unknown) => typeof p === "number") || !(j.duration > 0) || typeof j.max !== "number") return null;
      return j as PeaksFile;
    } catch { return null; }
  }

  private async make(abs: string, at: { key: string; buckets: number; size: number; file: string; prefix: string }): Promise<void> {
    try {
      const r = await decodePeaks(abs, at.buckets, peaksTimeoutMs(at.size));
      const body: PeaksFile = r ? { v: 1, key: at.key, buckets: at.buckets, duration: r.duration, max: r.max, peaks: r.peaks } : { v: 1, key: at.key, audio: false };
      await mkdir(join(this.dir, PEAKS_DIR), { recursive: true });
      const tmp = `${at.file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(body));
      await rename(tmp, at.file);
      // an older render's waveform is no use any more
      for (const f of await readdir(join(this.dir, PEAKS_DIR)).catch(() => [] as string[])) {
        if (f.startsWith(at.prefix) && f.endsWith(".json") && join(this.dir, PEAKS_DIR, f) !== at.file) await rm(join(this.dir, PEAKS_DIR, f), { force: true });
      }
    } catch (e) {
      this.failed.set(at.key, { reason: (e as Error).message, noFfmpeg: (e as { noFfmpeg?: boolean }).noFfmpeg });
    }
  }
}
