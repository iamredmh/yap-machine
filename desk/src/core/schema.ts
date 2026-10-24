import { z } from "zod";

/**
 * The desk's own files. Everything about the videos themselves (cuts, checks,
 * captions, shorts) lives in each Yap project's folder and is only ever read
 * here; the desk writes just these four, in <workspace>/.yap-desk/.
 */

const Base = { schema: z.literal(1), rev: z.number().int().min(0) };
const Id = z.string().min(1);
const When = z.string(); // ISO timestamp

export const NoteSchema = z.object({
  id: Id,
  project: z.string(),
  version: z.string(),
  /** Seconds into that version. */
  at: z.number().min(0),
  text: z.string().min(1).max(4000),
  /** open: waiting to send; sent: with the agent; done: the agent says it's fixed (check it); resolved: the person checked it. */
  status: z.enum(["open", "sent", "done", "resolved"]),
  batch: z.string().optional(),
  reply: z.string().optional(),
  /** The version where the fix landed, when the agent says so. */
  fixedIn: z.string().optional(),
  /** When the person marked it resolved. */
  resolvedAt: When.optional(),
  /** How many times the person said "not fixed" and sent it back. */
  reopened: z.number().int().min(0).optional(),
  created: When,
});

export const MessageSchema = z.object({
  id: Id,
  project: z.string().optional(),
  from: z.enum(["you", "agent"]),
  text: z.string().max(8000),
  /** Files the user attached, as paths relative to the workspace. */
  files: z.array(z.string()).default([]),
  /** Set when a "you" message has gone out in a batch. */
  batch: z.string().optional(),
  created: When,
});

export const LookChangeSchema = z.object({
  project: z.string(),
  /** What changes, e.g. "accent", "captions.short", "person.red.title", "spelling". */
  key: z.string(),
  value: z.unknown(),
  /** How the desk describes it to people ("Highlight colour #E5402A"). */
  label: z.string(),
});

export const BatchSchema = z.object({
  id: Id,
  project: z.string(),
  version: z.string().optional(),
  notes: z.array(Id),
  messages: z.array(Id),
  look: z.array(LookChangeSchema),
  files: z.array(z.string()),
  status: z.enum(["waiting", "picked", "done"]),
  created: When,
  picked: When.optional(),
});

export const NotesFileSchema = z.object({ ...Base, notes: z.array(NoteSchema) });
export const ChatFileSchema = z.object({ ...Base, messages: z.array(MessageSchema) });
export const BatchesFileSchema = z.object({ ...Base, batches: z.array(BatchSchema) });
export const LookFileSchema = z.object({ ...Base, pending: z.array(LookChangeSchema) });

export type Note = z.infer<typeof NoteSchema>;
export type Message = z.infer<typeof MessageSchema>;
export type LookChange = z.infer<typeof LookChangeSchema>;
export type Batch = z.infer<typeof BatchSchema>;

export const FILES = {
  notes: { name: "notes.json", schema: NotesFileSchema },
  chat: { name: "chat.json", schema: ChatFileSchema },
  batches: { name: "batches.json", schema: BatchesFileSchema },
  look: { name: "look.json", schema: LookFileSchema },
} as const;

export type FileKey = keyof typeof FILES;
export type FileData = { [K in FileKey]: z.infer<(typeof FILES)[K]["schema"]> };
