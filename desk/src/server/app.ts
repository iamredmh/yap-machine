import { mkdir, readFile, realpath, rename, unlink, writeFile, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { watch } from "node:fs";
import { basename, extname, join, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { Store } from "../core/store.js";
import { DeskError, InvalidError, NotFoundError } from "../core/errors.js";
import { listProjects, readLook, readProject, readVersion } from "../core/workspace.js";
import { addLookChange, addMessage, addNote, expand, pickBatch, removeNote, reply, resumeBatch, sendBatch, setNoteState, waiting } from "../core/batches.js";
import { runEngine } from "../core/engine.js";
import { parseDoctor } from "../core/doctor.js";
import { PeaksCache } from "./peaks.js";
import { lookFrameArgs } from "./look-frame.js";
import { LAN_COOKIE, NEEDS_KEY_PAGE, isLoopbackHost, keyMatches, lanDenied, readCookie, type LanController } from "./lan.js";
import { contentType, inside, isJoinSheet, mediaSecurityHeaders, sendFile } from "./files.js";
import { slugify, uniqueId } from "../core/ids.js";
import { installFootage, nameImportedProject } from "./footage.js";
import { installVisuals } from "./visuals.js";
import type { LookChange } from "../core/schema.js";

export interface AppOptions {
  webDir?: string;
  onShutdown?: () => void;
  /** Phone access. Absent when the app is built without a server (tests). */
  lan?: LanController;
}

type Job = { id: string; project: string; footage: string; lines: string[]; state: "running" | "done" | "failed"; started: string };

/** The desk's HTTP API and the built web app. One server per workspace. */
export function createApp(store: Store, opts: AppOptions = {}) {
  const home = store.root;
  const app = new Hono();
  const listeners = new Set<(ev: { type: string; [k: string]: unknown }) => void>();
  const emit = (ev: { type: string; [k: string]: unknown }) => listeners.forEach((l) => l(ev));
  store.on("change", (c) => emit({ type: "desk", file: c.file }));
  const jobs = new Map<string, Job>();
  const peaks = new PeaksCache(store.dir);
  const waiters = new Set<() => void>();
  store.on("change", (c) => { if (c.file === "batches") waiters.forEach((w) => w()); });

  // The engine writes cuts, checks and renders into the project folders: tell open pages.
  let timer: NodeJS.Timeout | undefined;
  const touched = new Set<string>();
  try {
    watch(home, { recursive: true }, (_e, file) => {
      if (!file) return;
      const f = String(file);
      if (f.startsWith(".yap-desk") || f.includes("/cache/") || f.endsWith(".tmp") || f.includes(".prenorm.")) return;
      if (!/(project\.json|timeline\.json|qc\.md|joins\.json|\.mp4|style\.json|people\.json|phrases\.json)$/.test(f)) return;
      touched.add(f.split(/[\\/]/)[0]);
      clearTimeout(timer);
      timer = setTimeout(() => { for (const p of touched) emit({ type: "project", project: p }); touched.clear(); }, 400);
    });
  } catch { /* recursive watch unavailable: pages refresh on focus instead */ }

  // Two doors. The loopback one only answers to this computer's own names. The phone one (when it is open)
  // needs the code from the link, keeps the cookie it sets, and can't reach the dangerous routes.
  app.use("*", async (c, next) => {
    const onLan = !!(c.env as { lan?: boolean } | undefined)?.lan;
    if (!onLan) {
      if (!isLoopbackHost(new URL(c.req.url).host)) return c.json({ error: "bad_host", message: "The desk only answers to localhost." }, 421);
      return next();
    }
    const key = opts.lan?.key();
    const url = new URL(c.req.url);
    const given = url.searchParams.get("k");
    const ok = keyMatches(given, key) || keyMatches(readCookie(c.req.header("cookie"), LAN_COOKIE), key) || keyMatches(c.req.header("x-yap-key"), key);
    if (!ok) return new Response(key ? NEEDS_KEY_PAGE : "Phone access is off.", { status: key ? 401 : 403, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    if (lanDenied(c.req.method, url.pathname)) return c.json({ error: "not_from_phone", message: "That can only be done on the computer." }, 403);
    if (given) {
      url.searchParams.delete("k");
      const headers = new Headers({ location: url.pathname + url.search, "cache-control": "no-store" });
      headers.append("set-cookie", `${LAN_COOKIE}=${encodeURIComponent(given)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`);
      return new Response(null, { status: 302, headers });
    }
    return next();
  });

  app.onError((err, c) => {
    if (err instanceof DeskError) return c.json({ error: err.code, message: err.message, ...err.detail }, err.status as 400);
    if (err instanceof z.ZodError) return c.json({ error: "invalid", message: err.issues.map((i) => i.message).join("; ") }, 400);
    return c.json({ error: "server", message: (err as Error).message }, 500);
  });

  const project = async (id: string) => {
    if (!/^[\w.-]+$/.test(id)) throw new InvalidError("Bad project name");
    const p = await readProject(home, id);
    if (!p) throw new NotFoundError("project", id);
    return p;
  };
  installVisuals(app, home, emit);

  app.get("/api/lan", (c) => (opts.lan && !(c.env as { lan?: boolean } | undefined)?.lan ? c.json(opts.lan.info()) : c.json({ on: false, links: [], unavailable: true })));
  app.post("/api/lan", async (c) => {
    if (!opts.lan) throw new InvalidError("Phone access isn't available here");
    const b = z.object({ on: z.boolean() }).parse(await c.req.json());
    if (b.on) return c.json(await opts.lan.enable());
    await opts.lan.disable();
    return c.json(opts.lan.info());
  });

  app.get("/api/health", (c) => c.json({ app: "yap-machine", root: home }));

  app.get("/api/projects", async (c) => {
    const ids = await listProjects(home);
    const out = [];
    for (const id of ids) { const p = await readProject(home, id); if (p) out.push(p); }
    out.sort((a, b) => b.modified - a.modified);
    return c.json({ home, projects: out, jobs: [...jobs.values()] });
  });

  app.get("/api/projects/:p", async (c) => c.json(await project(c.req.param("p"))));

  app.get("/api/projects/:p/versions/:v", async (c) => {
    const id = c.req.param("p"), v = c.req.param("v");
    await project(id);
    const data = await readVersion(home, id, v);
    if (!data) throw new NotFoundError("version", v);
    return c.json(data);
  });

  // The waveform: 200 with peaks, 202 while ffmpeg is making them, 204 when the cut has no audio.
  app.get("/api/projects/:p/versions/:v/peaks", async (c) => {
    const id = c.req.param("p"), v = c.req.param("v");
    await project(id);
    if (!/^v\d+(\.s\d+)?$/.test(v)) throw new InvalidError("Bad version name");
    const data = await readVersion(home, id, v);
    if (!data) throw new NotFoundError("version", v);
    const a = await peaks.get(join(home, id, "renders", `${v}.mp4`), id, v, data.duration);
    c.header("cache-control", "no-store");
    if (a.state === "ready") return c.json(a.data);
    if (a.state === "computing") return c.json({ state: "computing" }, 202);
    if (a.state === "silent") return c.body(null, 204);
    if (a.state === "missing") return c.json({ error: "not_rendered", message: "This version hasn't been rendered yet." }, 404);
    return c.json({ error: a.noFfmpeg ? "no_ffmpeg" : "peaks_failed", message: a.noFfmpeg ? "The waveform needs ffmpeg, which wasn't found." : `Couldn't read this cut's audio: ${a.reason}` }, a.noFfmpeg ? 501 : 500);
  });

  // Finer waveform for a zoomed timeline: ?level=0..3&i=<tile>. 200 with the tile, 202 while the overview is still being made, 204 for a silent cut.
  app.get("/api/projects/:p/versions/:v/peaks/tile", async (c) => {
    const id = c.req.param("p"), v = c.req.param("v");
    await project(id);
    if (!/^v\d+(\.s\d+)?$/.test(v)) throw new InvalidError("Bad version name");
    const level = Number(c.req.query("level")), index = Number(c.req.query("i"));
    const data = await readVersion(home, id, v);
    if (!data) throw new NotFoundError("version", v);
    const a = await peaks.tile(join(home, id, "renders", `${v}.mp4`), id, v, data.duration, level, index);
    c.header("cache-control", "no-store");
    if (a.state === "ready") return c.json(a.data);
    if (a.state === "computing") return c.json({ state: "computing" }, 202);
    if (a.state === "silent") return c.body(null, 204);
    if (a.state === "missing") return c.json({ error: "not_rendered", message: "This version hasn't been rendered yet." }, 404);
    if (a.state === "range") return c.json({ error: "no_such_tile", message: "That stretch isn't in this cut." }, 404);
    return c.json({ error: a.noFfmpeg ? "no_ffmpeg" : "peaks_failed", message: a.noFfmpeg ? "The waveform needs ffmpeg, which wasn't found." : `Couldn't read this cut's audio: ${a.reason}` }, a.noFfmpeg ? 501 : 500);
  });

  // Renders, join pictures and posters. Only files inside the project's renders/, a cut's join pictures, or the desk's thumbs/ are served.
  app.get("/media/:p/*", async (c) => {
    const id = c.req.param("p");
    await project(id);
    const rel = decodeURIComponent(c.req.path.split(`/media/${id}/`)[1] ?? "");
    if (!rel.startsWith("renders/") && !isJoinSheet(rel)) return c.json({ error: "not_found" }, 404);
    const abs = inside(join(home, id), rel);
    if (!abs) return c.json({ error: "not_found" }, 404);
    const res = await sendFile(abs, c.req.header("range"), contentType(abs));
    for (const [k, v] of Object.entries(mediaSecurityHeaders())) res.headers.set(k, v);
    return res;
  });

  app.get("/poster/:p/:file", async (c) => {
    const id = c.req.param("p"), file = c.req.param("file");
    await project(id);
    if (!/^[\w.-]+\.mp4$/.test(file)) return c.json({ error: "not_found" }, 404);
    const src = join(home, id, "renders", file);
    const at = Number(c.req.query("t") ?? 2);
    const out = join(store.dir, "thumbs", `${id}__${file}__${at}.jpg`);
    try { await stat(out); } catch {
      await mkdir(join(store.dir, "thumbs"), { recursive: true });
      await new Promise<void>((ok) => {
        const ff = spawn("ffmpeg", ["-v", "error", "-y", "-ss", String(at), "-i", src, "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "5", out]);
        ff.on("close", () => ok()); ff.on("error", () => ok());
      });
    }
    return sendFile(out, undefined, "image/jpeg");
  });

  // A frame of a short with no captions or name card in it, for the Look preview: cut from the camera footage, cropped as the render was.
  // 404 when the footage isn't there or the segment is composited (a screen layer): the page then falls back to the render's own frame.
  app.get("/api/projects/:p/look-frame", async (c) => {
    const id = c.req.param("p"), v = c.req.query("version") ?? "";
    await project(id);
    const m = v.match(/^(v\d+)\.(s\d+)$/);
    if (!m) throw new InvalidError("Bad version name");
    const gone = () => c.json({ error: "no_clean_frame", message: "No frame without captions could be made for this short." }, 404);
    try {
      const tl = JSON.parse(await readFile(join(home, id, "cuts", m[1], "shorts", m[2], "timeline.json"), "utf8"));
      const seg = tl.segments?.[0];
      const pj = JSON.parse(await readFile(join(home, id, "project.json"), "utf8"));
      const src = (pj.sources ?? []).find((x: { id: string }) => x.id === seg?.source);
      if (!seg || !src?.path) return gone();
      const [tst, sst] = await Promise.all([stat(join(home, id, "cuts", m[1], "shorts", m[2], "timeline.json")), stat(src.path)]);
      const out = join(store.dir, "thumbs", `${id}__look__${v}__${Math.round(tst.mtimeMs)}-${Math.round(sst.mtimeMs)}.jpg`);
      try { await stat(out); } catch {
        const args = lookFrameArgs(seg, src.path, out);
        if (!args) return gone();
        await mkdir(join(store.dir, "thumbs"), { recursive: true });
        const ok = await new Promise<boolean>((done) => {
          const ff = spawn("ffmpeg", args);
          ff.on("close", (code) => done(code === 0)); ff.on("error", () => done(false));
        });
        if (!ok) return gone();
      }
      c.header("cache-control", "no-store");
      return sendFile(out, undefined, "image/jpeg");
    } catch { return gone(); }
  });

  // ---- notes, chat, files, look ------------------------------------------------
  app.get("/api/desk", async (c) => {
    const [notes, chat, batches, look] = await Promise.all([store.read("notes"), store.read("chat"), store.read("batches"), store.read("look")]);
    return c.json({ notes: notes.notes, messages: chat.messages, batches: batches.batches, look: look.pending });
  });

  app.post("/api/notes", async (c) => {
    const b = z.object({ project: z.string(), version: z.string(), at: z.number(), text: z.string().min(1) }).parse(await c.req.json());
    await project(b.project);
    return c.json(await addNote(store, b));
  });
  app.delete("/api/notes/:id", async (c) => { await removeNote(store, c.req.param("id")); return c.json({ ok: true }); });
  // the person checks what the agent fixed: resolve it, or send it back ("not fixed")
  app.post("/api/notes/:id/resolve", async (c) => c.json(await setNoteState(store, c.req.param("id"), "resolve")));
  app.post("/api/notes/:id/reopen", async (c) => c.json(await setNoteState(store, c.req.param("id"), "reopen")));

  app.post("/api/chat", async (c) => {
    const b = z.object({ project: z.string().optional(), text: z.string(), files: z.array(z.string()).optional() }).parse(await c.req.json());
    if (!b.text.trim() && !b.files?.length) throw new InvalidError("Write a message or attach a file first");
    const msg = await addMessage(store, { project: b.project, from: "you", text: b.text, files: b.files });
    // a chat message goes straight to the agent, together with anything else waiting
    let batch = null;
    if (b.project) {
      await applyLook(home, b.project, (await waiting(store, b.project)).look);
      batch = await sendBatch(store, b.project).catch(() => null);
    }
    return c.json({ message: msg, batch });
  });

  app.post("/api/upload", async (c) => {
    const form = await c.req.formData();
    const file = form.get("file");
    const proj = String(form.get("project") ?? "");
    if (!(file instanceof File)) throw new InvalidError("No file in the upload");
    if (proj) {
      if (!/^\w[\w.-]*$/.test(proj)) throw new InvalidError("Bad project name");
      await project(proj);
    }
    const name = basename(file.name).replace(/[^\w. -]+/g, "_").slice(0, 120);
    const safe = !name || name === "." || name === ".." ? "file" : name;
    const root = await realpath(home);
    const parent = await realpath(proj ? join(home, proj) : store.dir);
    if (!parent.startsWith(root + sep)) throw new InvalidError("Uploads must stay inside this workspace");
    const dir = join(parent, "uploads");
    await mkdir(dir, { recursive: true });
    if (await realpath(dir) !== dir) throw new InvalidError("The upload folder cannot be a symbolic link");
    // Replace the directory entry atomically, never follow an existing file's symlink
    // or modify another hard link to its bytes.
    const pending = join(dir, `.upload-${randomUUID()}.tmp`);
    try {
      await writeFile(pending, Buffer.from(await file.arrayBuffer()), { flag: "wx" });
      await rename(pending, join(dir, safe));
    } finally { await unlink(pending).catch(() => {}); }
    return c.json({ path: proj ? `${proj}/uploads/${safe}` : `.yap-desk/uploads/${safe}`, name: safe, size: file.size });
  });

  app.get("/api/projects/:p/look", async (c) => c.json(await readLook(home, c.req.param("p"))));
  app.post("/api/projects/:p/look", async (c) => {
    const id = c.req.param("p");
    await project(id);
    const b = z.object({ key: z.string(), value: z.unknown(), label: z.string() }).parse(await c.req.json());
    await addLookChange(store, { project: id, ...b } as LookChange);
    return c.json({ ok: true });
  });

  app.get("/api/projects/:p/waiting", async (c) => c.json(await waiting(store, c.req.param("p"))));

  app.post("/api/projects/:p/send", async (c) => {
    const id = c.req.param("p");
    await project(id);
    const b = z.object({ version: z.string().optional() }).parse(await c.req.json().catch(() => ({})));
    const pending = await waiting(store, id);
    await applyLook(home, id, pending.look);
    return c.json(await sendBatch(store, id, b.version));
  });

  // ---- the agent's side (the MCP server calls these) ----------------------------
  app.get("/api/agent/next", async (c) => {
    const proj = c.req.query("project") || undefined;
    const wait = Math.min(Number(c.req.query("wait") ?? 0), 600);
    const deadline = Date.now() + wait * 1000;
    for (;;) {
      const b = await pickBatch(store, proj);
      if (b) return c.json({ batch: await expand(store, b) });
      if (Date.now() >= deadline) return c.json({ batch: null });
      await new Promise<void>((ok) => { const w = () => { waiters.delete(w); ok(); }; waiters.add(w); setTimeout(w, Math.max(0, deadline - Date.now())); });
    }
  });

  app.post("/api/agent/resume", async (c) => {
    const { batch } = z.object({ batch: z.string().min(1) }).parse(await c.req.json());
    return c.json({ batch: await expand(store, await resumeBatch(store, batch)) });
  });

  app.post("/api/agent/reply", async (c) => {
    const b = z.object({
      project: z.string(), message: z.string().min(1), batch: z.string().optional(), version: z.string().optional(),
      notes: z.array(z.object({ id: z.string(), reply: z.string() })).optional(), done: z.boolean().optional(),
    }).parse(await c.req.json());
    return c.json(await reply(store, b));
  });

  // ---- inbox: a new footage folder becomes a project ------------------------------
  const startProject = async (footage: string, name?: string, existingId?: string) => {
    const id = existingId ?? uniqueId(slugify(name || basename(footage)), [...await listProjects(home), ...jobs.keys()]);
    if (jobs.get(id)?.state === "running") throw new InvalidError("This project is already being prepared.");
    const job: Job = { id, project: id, footage, lines: [], state: "running", started: new Date().toISOString() };
    jobs.set(id, job);
    const line = (l: string) => { job.lines.push(l); if (job.lines.length > 200) job.lines.shift(); emit({ type: "job", project: id, line: l }); };
    void (async () => {
      const init = existingId ? { code: 0, out: "" } : await runEngine(["init", join(home, id), "--footage", footage], line);
      if (!existingId && init.code === 0) await nameImportedProject(join(home, id), name);
      const prep = init.code === 0 ? await runEngine(["prep", "-p", join(home, id)], line) : init;
      job.state = prep.code === 0 ? "done" : "failed";
      emit({ type: "job", project: id, state: job.state });
      if (job.state === "done") await addMessage(store, { project: id, from: "agent", text: `New footage is ready to cut: ${basename(footage)}. Ask your agent to "cut ${id} with Yap Machine", or send a note here.` });
    })().catch(e => { job.state = "failed"; line((e as Error).message); emit({ type: "job", project: id, state: job.state }); });
    return job;
  };
  installFootage(app, store.dir, startProject);
  app.post("/api/projects/:p/prepare", async c => {
    const p = await project(c.req.param("p"));
    if (!p.footage) throw new InvalidError("This project has no footage folder. Import its footage again.");
    return c.json(await startProject(p.footage, p.name, p.id), 202);
  });
  app.post("/api/projects", async c => {
    const b = z.object({ footage: z.string().min(1), name: z.string().optional() }).parse(await c.req.json());
    const footage = resolve(b.footage.replace(/^~(?=$|\/)/, process.env.HOME ?? "~"));
    try { if (!(await stat(footage)).isDirectory()) throw new Error(); } catch { throw new InvalidError(`There's no folder at ${footage}`); }
    return c.json(await startProject(footage, b.name));
  });

  app.get("/api/doctor", async (c) => {
    const r = await runEngine(["doctor"]);
    return c.json(parseDoctor(r.code, r.out));
  });

  // ---- live updates ------------------------------------------------------------
  app.get("/api/events", (c) =>
    streamSSE(c, async (stream) => {
      const send = (ev: { type: string }) => void stream.writeSSE({ event: ev.type, data: JSON.stringify(ev) });
      listeners.add(send);
      const ping = setInterval(() => void stream.writeSSE({ event: "ping", data: "{}" }), 20000);
      await new Promise<void>((ok) => stream.onAbort(() => ok()));
      clearInterval(ping);
      listeners.delete(send);
    }),
  );

  app.post("/api/shutdown", (c) => { setTimeout(() => opts.onShutdown?.(), 50); return c.json({ ok: true }); });

  // ---- the web app ---------------------------------------------------------------
  app.get("*", async (c) => {
    const web = opts.webDir;
    if (!web) return c.text("The desk's web files aren't built. Run npm run build in desk/.", 500);
    const rel = c.req.path === "/" ? "index.html" : c.req.path.slice(1);
    const abs = inside(web, rel);
    const file = abs && extname(abs) ? abs : join(web, "index.html");
    try {
      const body = await readFile(file);
      return new Response(body, { headers: { "content-type": contentType(file), "cache-control": file.endsWith("index.html") ? "no-cache" : "max-age=31536000, immutable" } });
    } catch {
      return new Response(await readFile(join(web, "index.html")), { headers: { "content-type": "text/html; charset=utf-8" } });
    }
  });

  return app;
}

/** Write sent look changes into the project's style.json / people.json, where the engine reads them. */
async function applyLook(home: string, id: string, changes: LookChange[]) {
  if (!changes.length) return;
  const dir = join(home, id);
  const read = async (f: string, d: any) => { try { return JSON.parse(await readFile(join(dir, f), "utf8")); } catch { return d; } };
  const style = await read("style.json", {});
  const people: any[] = await read("people.json", []);
  for (const ch of changes) {
    if (ch.key === "accent") style.accent = ch.value;
    else if (ch.key.startsWith("spelling")) { const [a, b] = ch.value as [string, string]; style.spellings = { ...(style.spellings ?? {}), [a.toLowerCase()]: b }; }
    else if (ch.key.startsWith("captions.")) { style.captions = { ...(style.captions ?? {}), [ch.key.split(".")[1]]: ch.value }; }
    else if (ch.key.startsWith("person.")) {
      const [, pid, field] = ch.key.split(".");
      let p = people.find((x) => x.id === pid);
      if (!p) { p = { id: pid, name: "" }; people.push(p); }
      p[field] = ch.value;
    }
  }
  await writeFile(join(dir, "style.json"), JSON.stringify(style, null, 2) + "\n");
  await writeFile(join(dir, "people.json"), JSON.stringify(people, null, 2) + "\n");
}
