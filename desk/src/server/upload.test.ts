import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Store } from "../core/store.js";
import { createApp } from "./app.js";

vi.mock("node:fs", async original => ({ ...await original<typeof import("node:fs")>(), watch: () => { throw new Error("No filesystem watcher in upload tests"); } }));

let temp: string, home: string, outside: string, app: ReturnType<typeof createApp>;
beforeEach(async () => {
  temp = await mkdtemp(join(tmpdir(), "yap-upload-security-"));
  home = join(temp, "workspace"); outside = join(temp, "outside");
  await mkdir(join(home, "project-1"), { recursive: true });
  await mkdir(outside);
  await writeFile(join(home, "project-1", "project.json"), JSON.stringify({ sources: [] }));
  const store = new Store(home); await store.init(); app = createApp(store);
});
afterEach(async () => { await rm(temp, { recursive: true, force: true }); });
const upload = (project: string, name = "notes.txt", text = "new notes") => {
  const form = new FormData(); form.set("project", project); form.set("file", new File([text], name));
  return app.request("http://localhost/api/upload", { method: "POST", body: form });
};

describe("attachment uploads stay in the chosen project", () => {
  it("keeps project and unassigned uploads, sanitizes filenames and safely replaces a previous attachment", async () => {
    expect((await upload("project-1", "../notes.txt")).status).toBe(200);
    expect((await upload("project-1", "notes.txt", "updated")).status).toBe(200);
    expect(await readFile(join(home, "project-1", "uploads", "notes.txt"), "utf8")).toBe("updated");
    expect(await readdir(join(home, "project-1", "uploads"))).toEqual(["notes.txt"]);
    expect((await upload("")).status).toBe(200);
    expect(await readFile(join(home, ".yap-desk", "uploads", "notes.txt"), "utf8")).toBe("new notes");
  });

  it("rejects traversal, absolute paths and unknown projects without creating an outside file", async () => {
    for (const project of ["../outside", "/tmp/outside", "..", ".", "project-1/../outside", "project-1\\..\\outside"])
      expect((await upload(project)).status).toBe(400);
    expect((await upload("unknown")).status).toBe(404);
    expect(await readdir(outside)).toEqual([]);
    expect(await readdir(home)).not.toContain("unknown");
  });

  it("rejects project and upload-directory symlinks that leave the allowed folder", async () => {
    await writeFile(join(outside, "project.json"), JSON.stringify({ sources: [] }));
    await symlink(outside, join(home, "linked-project"));
    expect((await upload("linked-project")).status).toBe(400);
    await symlink(outside, join(home, "project-1", "uploads"));
    expect((await upload("project-1")).status).toBe(400);
    await rm(join(home, ".yap-desk", "uploads"), { recursive: true });
    await symlink(outside, join(home, ".yap-desk", "uploads"));
    expect((await upload("")).status).toBe(400);
    expect(await readdir(outside)).toEqual(["project.json"]);
  });

  it("replaces a malicious destination symlink without following it or modifying its target", async () => {
    await mkdir(join(home, "project-1", "uploads"));
    const target = join(outside, "keep.txt"); await writeFile(target, "keep original");
    await symlink(target, join(home, "project-1", "uploads", "notes.txt"));
    expect((await upload("project-1")).status).toBe(200);
    expect(await readFile(target, "utf8")).toBe("keep original");
    expect(await readFile(join(home, "project-1", "uploads", "notes.txt"), "utf8")).toBe("new notes");
  });
});
