import type { Store } from "./store.js";
import type { Batch, LookChange, Message, Note } from "./schema.js";
import { EmptyBatchError, InvalidError, NotFoundError } from "./errors.js";
import { newId } from "./ids.js";

/**
 * The loop between the desk and the agent, after Rushes' notes → batch →
 * reply. Everything the person leaves for a project (notes on a version,
 * chat messages, files, look changes) waits until they press Send; then it
 * goes out as one batch the agent picks up, and the agent's replies come
 * back into the chat and onto each note.
 */

const now = () => new Date().toISOString();

export async function addNote(store: Store, n: { project: string; version: string; at: number; text: string }): Promise<Note> {
  const note: Note = { id: newId("n"), project: n.project, version: n.version, at: Math.max(0, n.at), text: n.text.trim(), status: "open", created: now() };
  await store.update("notes", (d) => { d.notes.push(note); });
  return note;
}

export async function removeNote(store: Store, id: string): Promise<void> {
  await store.update("notes", (d) => {
    const i = d.notes.findIndex((n) => n.id === id && n.status === "open");
    if (i < 0) throw new NotFoundError("open note", id);
    d.notes.splice(i, 1);
  });
}

export async function addMessage(store: Store, m: { project?: string; from: "you" | "agent"; text: string; files?: string[] }): Promise<Message> {
  const msg: Message = { id: newId("m"), project: m.project, from: m.from, text: m.text.trim(), files: m.files ?? [], created: now() };
  await store.update("chat", (d) => { d.messages.push(msg); });
  return msg;
}

export async function addLookChange(store: Store, change: LookChange): Promise<void> {
  await store.update("look", (d) => {
    // the latest value for the same thing wins
    d.pending = d.pending.filter((c) => !(c.project === change.project && c.key === change.key));
    d.pending.push(change);
  });
}

/** What is waiting to go to the agent for one project. */
export async function waiting(store: Store, project: string) {
  const [notes, chat, look] = await Promise.all([store.read("notes"), store.read("chat"), store.read("look")]);
  const msgs = chat.messages.filter((m) => m.from === "you" && !m.batch && (m.project ?? project) === project);
  return {
    notes: notes.notes.filter((n) => n.project === project && n.status === "open"),
    messages: msgs,
    look: look.pending.filter((c) => c.project === project),
    files: msgs.flatMap((m) => m.files),
  };
}

/** Bundle everything waiting for a project into one batch for the agent. */
export async function sendBatch(store: Store, project: string, version?: string): Promise<Batch> {
  const w = await waiting(store, project);
  if (!w.notes.length && !w.messages.length && !w.look.length) throw new EmptyBatchError(project);
  const batch: Batch = {
    id: newId("b"), project, version, status: "waiting", created: now(),
    notes: w.notes.map((n) => n.id), messages: w.messages.map((m) => m.id), look: w.look, files: w.files,
  };
  const noteIds = new Set(batch.notes), msgIds = new Set(batch.messages);
  await store.update("notes", (d) => { for (const n of d.notes) if (noteIds.has(n.id)) { n.status = "sent"; n.batch = batch.id; } });
  await store.update("chat", (d) => { for (const m of d.messages) if (msgIds.has(m.id)) m.batch = batch.id; });
  await store.update("look", (d) => { d.pending = d.pending.filter((c) => c.project !== project); });
  await store.update("batches", (d) => { d.batches.push(batch); });
  return batch;
}

/** The oldest batch the agent hasn't picked up, marked as picked. */
export async function pickBatch(store: Store, project?: string): Promise<Batch | null> {
  const { result } = await store.update("batches", (d) => {
    const b = d.batches.find((x) => x.status === "waiting" && (!project || x.project === project));
    if (b) { b.status = "picked"; b.picked = now(); }
    return b ?? null;
  });
  return result ? structuredClone(result) : null;
}

/** A batch with its notes and messages filled in, in the shape an agent reads. */
export async function expand(store: Store, batch: Batch) {
  const [notes, chat] = await Promise.all([store.read("notes"), store.read("chat")]);
  return {
    ...batch,
    notes: notes.notes.filter((n) => batch.notes.includes(n.id)),
    messages: chat.messages.filter((m) => batch.messages.includes(m.id)),
  };
}

/** The agent answers: a chat message, optional replies per note, and the version where fixes landed. */
export async function reply(store: Store, r: { project: string; message: string; batch?: string; notes?: { id: string; reply: string }[]; version?: string; done?: boolean }) {
  const msg = await addMessage(store, { project: r.project, from: "agent", text: r.message });
  if (r.notes?.length) {
    const byId = new Map(r.notes.map((n) => [n.id, n.reply]));
    await store.update("notes", (d) => {
      for (const n of d.notes) if (byId.has(n.id)) { n.reply = byId.get(n.id); n.status = "done"; if (r.version) n.fixedIn = r.version; }
    });
  }
  if (r.batch && r.done !== false) await store.update("batches", (d) => { const b = d.batches.find((x) => x.id === r.batch); if (b) b.status = "done"; });
  return msg;
}

/**
 * The person's half of a note's life. A note the agent says is fixed ("done") is checked: resolve it, or say it
 * isn't fixed and it goes back to waiting (with the agent's earlier reply kept, so the next batch shows it).
 * A resolved note can be reopened the same way.
 */
export async function setNoteState(store: Store, id: string, action: "resolve" | "reopen"): Promise<Note> {
  let out: Note | undefined;
  await store.update("notes", (d) => {
    const n = d.notes.find((x) => x.id === id);
    if (!n) throw new NotFoundError("note", id);
    if (action === "resolve") {
      if (n.status !== "done" && n.status !== "sent") throw new InvalidError(n.status === "resolved" ? "That note is already resolved." : "Only a note that has gone to your agent can be resolved. Remove it instead.");
      n.status = "resolved";
      n.resolvedAt = now();
    } else {
      if (n.status !== "done" && n.status !== "resolved") throw new InvalidError("Only a fixed or resolved note can be reopened.");
      n.status = "open";
      n.batch = undefined;
      n.resolvedAt = undefined;
      n.reopened = (n.reopened ?? 0) + 1;
    }
    out = { ...n };
  });
  return out!;
}
