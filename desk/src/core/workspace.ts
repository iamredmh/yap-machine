import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";

/**
 * Reads Yap projects straight from their folders. The engine (`yap-machine`) writes
 * these files; the desk never changes them.
 *
 *   <workspace>/<project>/project.json         footage, sources, sync
 *   <workspace>/<project>/phrases.json         every phrase, with flags
 *   <workspace>/<project>/cuts/vN/…            edl, timeline, qc.md, captions
 *   <workspace>/<project>/cuts/vN/shorts/sK/…  shorts cut from vN
 *   <workspace>/<project>/renders/*.mp4
 *   <workspace>/<project>/style.json, people.json
 */

export interface SourceInfo { id: string; kind: string; duration?: number; width?: number; height?: number; fps?: number; rel?: string; note?: string }
export interface Check { errors: string[]; warnings: string[]; summary: string[] }
export interface VersionInfo {
  version: string;
  parent?: string;
  duration: number;
  segments: number;
  render?: string;
  languages: string[];
  brief?: string;
  notes?: string;
  check: Check | null;
  /** Joins flagged by the re-listen (yap-machine check / yap-machine joins); null when this cut has no join report. */
  joins: { flagged: number; total: number; stale: boolean } | null;
  modified: number;
}
export interface JoinItem {
  n: number;
  at: number;
  flags: string[];
  outOf: string;
  into: string;
  /** What Whisper heard either side of the cut in the render, when the render was re-listened to. */
  heard: { before: string; after: string } | null;
  /** Path of the join's picture, relative to the project folder (served by /media). */
  sheet: string | null;
}
export interface JoinReport {
  items: JoinItem[];
  /** Whether the render was re-transcribed (otherwise only room sound was checked). */
  listened: boolean;
  /** The cut was resolved again after these joins were checked: positions may have moved. */
  stale: boolean;
}
export interface ProjectSummary {
  id: string;
  name: string;
  footage?: string;
  sources: SourceInfo[];
  phrases: number;
  retakes: number;
  versions: VersionInfo[];
  shorts: VersionInfo[];
  modified: number;
}

const exists = (p: string) => stat(p).then(() => true, () => false);

async function readJson<T = any>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Projects are folders in the workspace with a project.json the engine wrote. */
export async function listProjects(home: string): Promise<string[]> {
  let names: string[] = [];
  try {
    names = await readdir(home);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const n of names.sort()) {
    if (n.startsWith(".")) continue;
    const pj = await readJson<{ sources?: unknown }>(join(home, n, "project.json"));
    if (pj && Array.isArray(pj.sources)) out.push(n);
  }
  return out;
}

export function parseQc(text: string): Check {
  const out: Check = { errors: [], warnings: [], summary: [] };
  let section: "summary" | "errors" | "warnings" | "other" = "summary";
  for (const line of text.split("\n")) {
    if (line.startsWith("## Errors")) section = "errors";
    else if (line.startsWith("## Warnings")) section = "warnings";
    else if (line.startsWith("## ")) section = "other";
    else if (line.startsWith("- ") && section !== "other") {
      const item = line.slice(2).replace(/\*\*/g, "").trim();
      if (item === "none") continue;
      if (section === "summary") out.summary.push(item);
      else out[section].push(item);
    } else if (/^\s+- /.test(line) && section === "summary") out.summary.push(line.trim().slice(2));
  }
  return out;
}

async function versionInfo(projectDir: string, cutDir: string, version: string, parent?: string): Promise<VersionInfo | null> {
  const tl = await readJson<{ duration: number; segments: unknown[] }>(join(cutDir, "timeline.json"));
  if (!tl) return null;
  const edl = (await readJson<{ brief?: string; notes?: string }>(join(cutDir, "edl.json"))) ?? {};
  const name = parent ? `${parent}.${version}` : version;
  const render = (await exists(join(projectDir, "renders", `${name}.mp4`))) ? `renders/${name}.mp4` : undefined;
  const languages: string[] = [];
  try {
    for (const f of await readdir(join(projectDir, "renders"))) {
      const m = f.match(new RegExp(`^${name.replace(".", "\\.")}\\.([a-z]{2,3})\\.mp4$`));
      if (m) languages.push(m[1]);
    }
  } catch { /* no renders yet */ }
  let check: Check | null = null;
  try {
    check = parseQc(await readFile(join(cutDir, "qc.md"), "utf8"));
  } catch { /* not checked yet */ }
  const jr = await readJoins(projectDir, cutDir);
  const joins = jr ? { flagged: jr.items.filter((j) => j.flags.length).length, total: jr.items.length, stale: jr.stale } : null;
  const modified = (await stat(join(cutDir, "timeline.json"))).mtimeMs;
  return { version: name, parent, duration: tl.duration, segments: tl.segments.length, render, languages, brief: edl.brief, notes: edl.notes, check, joins, modified };
}

const byVersion = (a: string, b: string) => Number(a.replace(/\D/g, "")) - Number(b.replace(/\D/g, ""));

export async function readProject(home: string, id: string): Promise<ProjectSummary | null> {
  const dir = join(home, id);
  const pj = await readJson<{ footage?: string; sources: any[] }>(join(dir, "project.json"));
  if (!pj) return null;
  const phrases = (await readJson<any[]>(join(dir, "phrases.json"))) ?? [];
  const versions: VersionInfo[] = [];
  const shorts: VersionInfo[] = [];
  let cuts: string[] = [];
  try {
    cuts = (await readdir(join(dir, "cuts"))).filter((v) => /^v\d+$/.test(v)).sort(byVersion);
  } catch { /* no cuts yet */ }
  for (const v of cuts) {
    const info = await versionInfo(dir, join(dir, "cuts", v), v);
    if (info) versions.push(info);
    let ss: string[] = [];
    try {
      ss = (await readdir(join(dir, "cuts", v, "shorts"))).filter((s) => /^s\d+$/.test(s)).sort(byVersion);
    } catch { /* no shorts */ }
    for (const s of ss) {
      const si = await versionInfo(dir, join(dir, "cuts", v, "shorts", s), s, v);
      if (si) shorts.push(si);
    }
  }
  const sources: SourceInfo[] = pj.sources.map((s) => ({
    id: s.id, kind: s.kind, duration: s.duration, width: s.width, height: s.height, fps: s.fps, rel: s.rel,
    note: s.audio ? `sound from ${s.audio.source}, lined up ${s.audio.method === "picture" ? "from the picture" : "by voice"} (${s.audio.offset > 0 ? "+" : ""}${Number(s.audio.offset).toFixed(2)}s)`
      : s.sync ? `lined up by voice, ${Math.abs(s.sync.offset).toFixed(2)}s ${s.sync.offset < 0 ? "in" : "before"}`
      : s.kind === "camera" ? "sound recorded in camera" : undefined,
  }));
  const modified = Math.max((await stat(join(dir, "project.json"))).mtimeMs, ...versions.map((v) => v.modified), ...shorts.map((v) => v.modified));
  return {
    id,
    name: (pj as any).name || prettyName(id),
    footage: pj.footage,
    sources,
    phrases: phrases.length,
    retakes: phrases.filter((p) => p.flags?.includes("retake")).length,
    versions,
    shorts,
    modified,
  };
}

export function prettyName(id: string): string {
  return basename(id).replace(/^t\d+-/, "").replace(/[-_]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function cutDirOf(dir: string, version: string): string {
  const [v, s] = version.split(".");
  return s ? join(dir, "cuts", v, "shorts", s) : join(dir, "cuts", v);
}

const respell = (text: string, spellings: Record<string, string>) =>
  text.replace(/[\w.'-]+/g, (w) => {
    const m = w.match(/^(.*?)([.,!?;:]*)$/)!;
    const fix = spellings[m[1].toLowerCase()];
    return fix ? fix + m[2] : w;
  });

/** The join report `yap-machine check` / `yap-machine joins` wrote for a cut, or null when there isn't one. */
export async function readJoins(dir: string, cut: string): Promise<JoinReport | null> {
  const path = join(cut, "joins.json");
  const j = await readJson<any>(path);
  if (!j || !Array.isArray(j.joins)) return null;
  const items: JoinItem[] = j.joins.map((x: any) => ({
    n: Number(x.n), at: Number(x.at),
    flags: Array.isArray(x.flags) ? x.flags.map(String) : [],
    outOf: String(x.out_of ?? ""), into: String(x.into ?? ""),
    heard: x.listen ? { before: String(x.listen.before ?? ""), after: String(x.listen.after ?? "") } : null,
    sheet: typeof x.sheet === "string" && /^joins\/join-\d{3}\.png$/.test(x.sheet) ? relative(dir, join(cut, x.sheet)).split(sep).join("/") : null,
  }));
  let stale = false;
  try { stale = (await stat(join(cut, "timeline.json"))).mtimeMs > (await stat(path)).mtimeMs + 1000; } catch { /* keep false */ }
  return { items, listened: !!j.asr, stale };
}

/** One version for review: what's said, where, on camera or screen, and why the agent chose it. */
export async function readVersion(home: string, id: string, version: string) {
  const dir = join(home, id);
  const cut = cutDirOf(dir, version);
  const tl = await readJson<any>(join(cut, "timeline.json"));
  if (!tl) return null;
  const edl = (await readJson<any>(join(cut, "edl.json"))) ?? { ranges: [] };
  const style = (await readJson<any>(join(dir, "style.json"))) ?? {};
  const spellings = Object.fromEntries(Object.entries(style.spellings ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
  const segments = tl.segments.map((s: any) => ({
    t: s.out_start, e: s.out_end, beat: s.beat || "", layout: s.layout || "face", range: s.range,
    // where this stretch comes from in the raw footage: what lets two versions be compared by content, not by clock
    src: s.source ?? "", ss: s.start ?? 0, se: s.end ?? 0,
    text: respell(s.text, spellings),
  }));
  const reasons = (edl.ranges ?? []).map((r: any, i: number) => ({ range: i, beat: r.beat || "", why: r.why || "", from: r.from, to: r.to }));
  let check: Check | null = null;
  try { check = parseQc(await readFile(join(cut, "qc.md"), "utf8")); } catch { /* not checked */ }
  const used = new Set<string>();
  const phrases = (await readJson<any[]>(join(dir, "phrases.json"))) ?? [];
  const order = phrases.map((p) => p.id);
  for (const r of edl.ranges ?? []) {
    if (!r.from) continue;
    const a = order.indexOf(r.from), b = order.indexOf(r.to ?? r.from);
    for (let i = a; i >= 0 && i <= b; i++) used.add(order[i]);
  }
  const left = phrases
    .filter((p) => !used.has(p.id) && p.words?.length >= 3)
    .map((p) => ({ id: p.id, at: p.start, text: respell(p.text, spellings), flags: p.flags ?? [], alts: p.alts ?? [] }));
  const joins = await readJoins(dir, cut);
  // the render's size and modified time: whatever is drawn from the render (the waveform) is keyed by it, so a re-render is never stale
  let renderRev: string | null = null;
  try { const st = await stat(join(dir, "renders", `${version}.mp4`)); renderRev = `${st.size}-${Math.round(st.mtimeMs)}`; } catch { /* not rendered yet */ }
  const fps = Number(tl.fps) > 0 ? Number(tl.fps) : null;
  return { version, duration: tl.duration, width: tl.width, height: tl.height, fps, renderRev, segments, reasons, check, joins, left, brief: edl.brief, notes: edl.notes };
}

export async function readLook(home: string, id: string) {
  const dir = join(home, id);
  const style = (await readJson<any>(join(dir, "style.json"))) ?? {};
  const people = (await readJson<any[]>(join(dir, "people.json"))) ?? [];
  return { accent: style.accent ?? "#F0412B", spellings: style.spellings ?? {}, captions: style.captions ?? {}, people };
}
