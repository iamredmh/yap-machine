/** The waveform's data in the browser: ask the desk for a version's peaks, wait while it makes them, remember the answer per render. */

/** Peaks 0..1, spread evenly over `duration` seconds. */
export interface Wave { peaks: Float32Array; duration: number }
export type WaveState =
  | { kind: "loading" }
  | { kind: "wave"; wave: Wave }
  | { kind: "silent" }
  | { kind: "unrendered" }
  | { kind: "error"; message: string };

export const peaksUrl = (project: string, version: string, rev: string | null) =>
  `/api/projects/${encodeURIComponent(project)}/versions/${encodeURIComponent(version)}/peaks${rev ? `?rev=${encodeURIComponent(rev)}` : ""}`;

/** One remembered answer per render: a re-render has a new revision, so it asks again. */
export const peaksCacheKey = (project: string, version: string, rev: string | null) => `${project}/${version}/${rev ?? "none"}`;

/** What a response from the peaks route means. 202 is "ask again soon". */
export function classifyPeaks(status: number, body: unknown): WaveState | "pending" {
  if (status === 202) return "pending";
  if (status === 204) return { kind: "silent" };
  if (status === 404) return { kind: "unrendered" };
  if (status === 200) {
    const j = body as { peaks?: unknown; duration?: unknown } | null;
    const peaks = j?.peaks;
    if (Array.isArray(peaks) && peaks.length > 0 && typeof j?.duration === "number" && j.duration > 0 && peaks.every((p) => typeof p === "number" && Number.isFinite(p))) {
      return { kind: "wave", wave: { peaks: Float32Array.from(peaks as number[]), duration: j.duration } };
    }
    return { kind: "error", message: "The waveform file wasn't readable." };
  }
  const message = (body as { message?: string } | null)?.message;
  return { kind: "error", message: message ?? `The waveform couldn't be made (${status}).` };
}

const cache = new Map<string, WaveState>();

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((ok, fail) => {
  const t = setTimeout(ok, ms);
  signal.addEventListener("abort", () => { clearTimeout(t); fail(new DOMException("aborted", "AbortError")); }, { once: true });
});

/** Loads (and polls for) a version's peaks. Rejects only when `signal` aborts, so a late answer never lands on another version. */
export async function loadPeaks(project: string, version: string, rev: string | null, signal: AbortSignal, onWait?: () => void): Promise<WaveState> {
  const key = peaksCacheKey(project, version, rev);
  const hit = cache.get(key);
  if (hit) return hit;
  for (let tries = 0; tries < 300; tries++) {
    let res: Response;
    try { res = await fetch(peaksUrl(project, version, rev), { signal }); }
    catch (e) { if (signal.aborted) throw e; return { kind: "error", message: "The desk didn't answer." }; }
    const body = res.status === 204 ? null : await res.json().catch(() => null);
    const c = classifyPeaks(res.status, body);
    if (c !== "pending") { if (c.kind === "wave" || c.kind === "silent") cache.set(key, c); return c; }
    onWait?.();
    await sleep(tries < 5 ? 600 : 1500, signal);
  }
  return { kind: "error", message: "Reading the audio is taking a long time." };
}

// ---- detail tiles --------------------------------------------------------------------------------

export const tileUrl = (project: string, version: string, rev: string | null, level: number, index: number) =>
  `/api/projects/${encodeURIComponent(project)}/versions/${encodeURIComponent(version)}/peaks/tile?level=${level}&i=${index}${rev ? `&rev=${encodeURIComponent(rev)}` : ""}`;

export const tileKey = (project: string, version: string, rev: string | null, level: number, index: number) => `${peaksCacheKey(project, version, rev)}/${level}/${index}`;

/** What a response from the tile route means: the peaks, "pending" (ask again), or null (no tile: silent, out of range, or an error: draw from the overview). */
export function classifyTile(status: number, body: unknown): Float32Array | "pending" | null {
  if (status === 202) return "pending";
  if (status !== 200) return null;
  const peaks = (body as { peaks?: unknown } | null)?.peaks;
  if (Array.isArray(peaks) && peaks.length > 0 && peaks.every((p) => typeof p === "number" && Number.isFinite(p))) return Float32Array.from(peaks as number[]);
  return null;
}

const MAX_TILES = 240;
const tiles = new Map<string, Float32Array | null>();
/** A tile being fetched, and how many views still want it: one that nobody wants any more is dropped if it hasn't started. */
interface Job { wanted: number; promise: Promise<void> }
const jobs = new Map<string, Job>();
let active = 0;
const waiting: (() => void)[] = [];
const MAX_FETCHES = 4;

/** A tile already in memory (null: asked for and there is none), or undefined when it hasn't been fetched. */
export function cachedTile(key: string): Float32Array | null | undefined {
  const t = tiles.get(key);
  if (t !== undefined) { tiles.delete(key); tiles.set(key, t); }     // most recently used goes last
  return t;
}

/**
 * Fetches a tile and remembers it; many callers asking for one tile share one request. A caller that aborts only says it no longer
 * cares: a fetch that has started finishes (the tile is wanted again soon, and the desk keeps it), one still waiting its turn is dropped.
 * The oldest tiles are forgotten past a few hundred (about a megabyte).
 */
export function loadTile(project: string, version: string, rev: string | null, level: number, index: number, signal: AbortSignal): Promise<void> {
  const key = tileKey(project, version, rev, level, index);
  if (tiles.has(key)) return Promise.resolve();
  let job = jobs.get(key);
  if (!job) {
    job = { wanted: 0, promise: Promise.resolve() };
    jobs.set(key, job);
    job.wanted++;
    job.promise = fetchTile(job, key, project, version, rev, level, index);
  } else job.wanted++;
  const mine = job;
  signal.addEventListener("abort", () => { mine.wanted--; }, { once: true });
  return job.promise;
}

async function fetchTile(job: Job, key: string, project: string, version: string, rev: string | null, level: number, index: number): Promise<void> {
  if (active >= MAX_FETCHES) await new Promise<void>((go) => waiting.push(go));
  if (job.wanted <= 0) { jobs.delete(key); waiting.shift()?.(); return; }
  active++;
  try {
    for (let tries = 0; tries < 40; tries++) {
      let res: Response;
      try { res = await fetch(tileUrl(project, version, rev, level, index)); } catch { return; }
      const body = res.status === 200 ? await res.json().catch(() => null) : null;
      const c = classifyTile(res.status, body);
      if (c === "pending") { await new Promise((ok) => setTimeout(ok, 500)); continue; }
      tiles.set(key, c);
      while (tiles.size > MAX_TILES) tiles.delete(tiles.keys().next().value as string);
      return;
    }
  } finally { active--; jobs.delete(key); waiting.shift()?.(); }
}
