import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { addNote, expand, reply, sendBatch, setNoteState, waiting } from "./batches.js";
import { Store } from "./store.js";

let home: string;
let store: Store;
beforeEach(async () => { home = await mkdtemp(join(tmpdir(), "yap-notes-")); store = new Store(home); await store.init(); });
afterEach(async () => { await rm(home, { recursive: true, force: true }); });

it("a note on a short goes out with the long cut's notes, keeps its version and time, and the agent's reply lands on it", async () => {
  await addNote(store, { project: "p1", version: "v4", at: 10, text: "tighten the hook" });
  const short = await addNote(store, { project: "p1", version: "v2.s1", at: 4.6, text: "check the join here" });
  await addNote(store, { project: "other", version: "v2.s1", at: 1, text: "not this project" });
  expect((await waiting(store, "p1")).notes).toHaveLength(2);

  const batch = await sendBatch(store, "p1");
  const seen = await expand(store, batch);
  expect(seen.notes.map((n) => [n.version, n.at])).toEqual([["v4", 10], ["v2.s1", 4.6]]);

  await reply(store, { project: "p1", message: "re-cut", batch: batch.id, version: "v2.s4", notes: [{ id: short.id, reply: "moved the cut" }] });
  const done = (await store.read("notes")).notes.find((n) => n.id === short.id)!;
  expect(done).toMatchObject({ status: "done", fixedIn: "v2.s4", reply: "moved the cut" });
  // the other project's note was never in the batch
  expect((await store.read("notes")).notes.filter((n) => n.status === "open")).toHaveLength(1);
});

it("a note's life: waiting, with the agent, fixed (to check), then resolved, or sent back with the last reply kept", async () => {
  const a = await addNote(store, { project: "p1", version: "v4", at: 10, text: "tighten the hook" });
  const b = await addNote(store, { project: "p1", version: "v4", at: 20, text: "name is misspelt" });
  // a waiting note can't be resolved (remove it instead) or reopened
  await expect(setNoteState(store, a.id, "resolve")).rejects.toThrow(/Remove it instead/);
  await expect(setNoteState(store, a.id, "reopen")).rejects.toThrow();
  const batch = await sendBatch(store, "p1");
  await reply(store, { project: "p1", message: "v5", batch: batch.id, version: "v5", notes: [{ id: a.id, reply: "cut 2 s" }, { id: b.id, reply: "fixed the spelling" }] });

  const ok = await setNoteState(store, a.id, "resolve");
  expect(ok).toMatchObject({ status: "resolved", fixedIn: "v5", reply: "cut 2 s" });
  expect(ok.resolvedAt).toBeTruthy();
  await expect(setNoteState(store, a.id, "resolve")).rejects.toThrow(/already resolved/);

  const back = await setNoteState(store, b.id, "reopen");
  expect(back).toMatchObject({ status: "open", reopened: 1, reply: "fixed the spelling", fixedIn: "v5" });
  expect(back.batch).toBeUndefined();
  // it waits to be sent again, and goes out with what was tried
  expect((await waiting(store, "p1")).notes.map((n) => n.id)).toEqual([b.id]);
  const again = await expand(store, await sendBatch(store, "p1"));
  expect(again.notes[0]).toMatchObject({ id: b.id, reopened: 1, reply: "fixed the spelling" });

  // a resolved note can be reopened too, and counts up
  const re = await setNoteState(store, a.id, "reopen");
  expect(re).toMatchObject({ status: "open", reopened: 1 });
  expect(re.resolvedAt).toBeUndefined();
  await expect(setNoteState(store, "n_nope", "resolve")).rejects.toThrow();
});
