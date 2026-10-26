import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { addMessage, addNote, expand, pickBatch, reply, resumeBatch, sendBatch } from "./batches.js";
import { Store } from "./store.js";

let home: string, store: Store;
beforeEach(async () => { home = await mkdtemp(join(tmpdir(), "yap-batch-resume-")); store = new Store(home); await store.init(); });
afterEach(async () => { await rm(home, { recursive: true, force: true }); });

async function sent() {
  const note = await addNote(store, { project: "p1", version: "v1", at: 12, text: "Tighten this pause" });
  await addMessage(store, { project: "p1", from: "you", text: "Keep the opening", files: ["p1/uploads/example.jpg"] });
  return { note, batch: await sendBatch(store, "p1", "v1") };
}

it("recovers the same batch after restart without duplicating or requeueing active work", async () => {
  const { note, batch } = await sent();
  const picked = await pickBatch(store);
  expect(picked?.id).toBe(batch.id);
  expect(await pickBatch(store)).toBeNull();
  const restarted = new Store(home);
  const before = await readFile(store.path("batches"), "utf8");
  const [a, b] = await Promise.all([resumeBatch(restarted, batch.id), resumeBatch(restarted, batch.id)]);
  expect(a).toEqual(picked);
  expect(b).toEqual(picked);
  expect(await readFile(store.path("batches"), "utf8")).toBe(before);
  expect((await expand(restarted, a)).notes).toMatchObject([{ id: note.id, status: "sent" }]);
  expect((await expand(restarted, a)).files).toEqual(["p1/uploads/example.jpg"]);
  expect(await pickBatch(restarted)).toBeNull();
});

it("keeps partial replies on recovery and completes the original batch with its original note IDs", async () => {
  const { note, batch } = await sent();
  await pickBatch(store);
  await reply(store, { project: "p1", batch: batch.id, done: false, version: "v2", message: "The pause is shorter", notes: [{ id: note.id, reply: "Removed two seconds" }] });
  const resumed = await expand(store, await resumeBatch(store, batch.id));
  expect(resumed.notes[0]).toMatchObject({ id: note.id, status: "done", reply: "Removed two seconds", fixedIn: "v2" });
  await reply(store, { project: "p1", batch: resumed.id, version: "v2", message: "v2 is ready" });
  expect((await store.read("batches")).batches).toMatchObject([{ id: batch.id, status: "done" }]);
  expect((await store.read("notes")).notes).toHaveLength(1);
  await expect(resumeBatch(store, batch.id)).rejects.toThrow(/already completed/);
  expect(await pickBatch(store)).toBeNull();
});

it("rejects unknown and waiting batches instead of accidentally claiming them", async () => {
  const { batch } = await sent();
  await expect(resumeBatch(store, "missing")).rejects.toThrow(/not found/);
  await expect(resumeBatch(store, batch.id)).rejects.toThrow(/yap_next_batch/);
  expect((await pickBatch(store))?.id).toBe(batch.id);
});
