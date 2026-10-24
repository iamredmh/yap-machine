import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { isJoinSheet } from "./files.js";
import { Store } from "../core/store.js";
import { readJoins, readProject, readVersion } from "../core/workspace.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");

let home: string;
beforeEach(async () => { home = await mkdtemp(join(tmpdir(), "yap-desk-")); });
afterEach(async () => { await rm(home, { recursive: true, force: true }); });

async function project(joins: unknown, opts: { short?: boolean } = {}) {
  const dir = join(home, "p1");
  const cut = opts.short ? join(dir, "cuts", "v2", "shorts", "s1") : join(dir, "cuts", "v1");
  await mkdir(join(cut, "joins"), { recursive: true });
  await writeFile(join(dir, "project.json"), JSON.stringify({ sources: [{ id: "a", kind: "camera" }] }));
  await writeFile(join(cut, "timeline.json"), JSON.stringify({ duration: 10, width: 1280, height: 720, segments: [] }));
  await writeFile(join(cut, "edl.json"), JSON.stringify({ ranges: [] }));
  if (joins) await writeFile(join(cut, "joins.json"), JSON.stringify(joins));
  await writeFile(join(cut, "joins", "join-001.png"), PNG);
  return { dir, cut };
}

const REPORT = {
  asr: true,
  joins: [
    { n: 1, at: 3.52, flags: ["start of the line after the cut: \"gadget\" clipped (heard: get)"], out_of: "use inside the app?", into: "Well now you can.",
      listen: { before: "inside the app", after: "well now you can" }, sheet: "joins/join-001.png" },
    { n: 2, at: 8.1, flags: [], out_of: "a", into: "b", listen: null, sheet: "../../../secret.png" },
  ],
};

describe("join report", () => {
  it("is read into the version data with sheet paths relative to the project", async () => {
    await project(REPORT);
    const v = await readVersion(home, "p1", "v1");
    expect(v!.joins!.listened).toBe(true);
    const [a, b] = v!.joins!.items;
    expect(a).toMatchObject({ n: 1, at: 3.52, outOf: "use inside the app?", sheet: "cuts/v1/joins/join-001.png", heard: { before: "inside the app", after: "well now you can" } });
    expect(a.flags).toHaveLength(1);
    expect(b.sheet).toBeNull(); // a sheet path that isn't join-NNN.png in joins/ is never passed on
    expect(b.heard).toBeNull();
  });

  it("finds a short's joins under its parent", async () => {
    await project(REPORT, { short: true });
    const v = await readVersion(home, "p1", "v2.s1");
    expect(v!.joins!.items[0].sheet).toBe("cuts/v2/shorts/s1/joins/join-001.png");
  });

  it("is null when the cut has none, and stale when the cut was resolved again afterwards", async () => {
    const { dir, cut } = await project(null);
    expect((await readVersion(home, "p1", "v1"))!.joins).toBeNull();
    await writeFile(join(cut, "joins.json"), JSON.stringify(REPORT));
    const old = new Date(Date.now() - 60_000);
    await utimes(join(cut, "joins.json"), old, old);
    expect((await readJoins(dir, cut))!.stale).toBe(true);
    const now = new Date();
    await utimes(join(cut, "joins.json"), now, now);
    expect((await readJoins(dir, cut))!.stale).toBe(false);
  });
});

describe("serving join pictures", () => {
  it("allows only the join pictures of a cut or short", () => {
    expect(isJoinSheet("cuts/v1/joins/join-001.png")).toBe(true);
    expect(isJoinSheet("cuts/v2/shorts/s3/joins/join-012.png")).toBe(true);
    for (const bad of ["cuts/v1/edl.json", "cuts/v1/joins/join-1.png", "cuts/v1/joins/../edl.json", "cuts/v1/joins/join-001.png/../../edl.json",
      "project.json", "cuts/v1/shorts/s1/../../x/joins/join-001.png", "cuts/v1/joins/join-001.svg", ".yap-desk/notes.json"]) expect(isJoinSheet(bad), bad).toBe(false);
  });

  it("answers /media for a join picture, and refuses other project files", async () => {
    await project(REPORT);
    await writeFile(join(home, "p1", "cuts", "v1", "qc.md"), "# QC");
    const store = new Store(home);
    await store.init();
    const app = createApp(store);
    const ok = await app.request("/media/p1/cuts/v1/joins/join-001.png");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/png");
    expect(ok.headers.get("content-security-policy")).toContain("sandbox");
    expect((await app.request("/media/p1/cuts/v1/qc.md")).status).toBe(404);
    expect((await app.request("/media/p1/cuts/v1/edl.json")).status).toBe(404);
    expect((await app.request("/media/p1/cuts/v1/joins/join-002.png")).status).toBe(404); // not on disk
  });
});

describe("join counts in the project summary", () => {
  it("count flagged joins for the long cut and for each short, null when there is no report", async () => {
    const { dir } = await project(REPORT);                       // cuts/v1 with a report (1 flagged of 2)
    const short = join(dir, "cuts", "v1", "shorts", "s1");
    await mkdir(short, { recursive: true });                     // a short with no report
    await writeFile(join(short, "timeline.json"), JSON.stringify({ duration: 5, width: 1080, height: 1920, segments: [] }));
    const short2 = join(dir, "cuts", "v1", "shorts", "s2");
    await mkdir(join(short2, "joins"), { recursive: true });     // a short with a clean report
    await writeFile(join(short2, "timeline.json"), JSON.stringify({ duration: 5, width: 1080, height: 1920, segments: [] }));
    await writeFile(join(short2, "joins.json"), JSON.stringify({ asr: false, joins: [{ n: 1, at: 1, flags: [], out_of: "a", into: "b", listen: null, sheet: null }] }));
    const p = await readProject(home, "p1");
    expect(p!.versions[0].joins).toMatchObject({ flagged: 1, total: 2 });
    const [s1, s2] = p!.shorts;
    expect(s1.version).toBe("v1.s1");
    expect(s1.joins).toBeNull();
    expect(s2.joins).toMatchObject({ flagged: 0, total: 1, stale: false });
  });
});
