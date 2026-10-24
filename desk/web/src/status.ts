/**
 * One honest status for a version, used everywhere a version's state is shown (Review header, Review tab,
 * each short card, the Inbox project card). Errors come first ("N to fix"); then anything to look at
 * (warnings that aren't about joins, plus flagged joins); then "All clear". The check and the join report
 * are counted once, together, so two places can never disagree.
 */
export type StatusKind = "fix" | "look" | "clear" | "unchecked";
export interface Status {
  kind: StatusKind;
  count: number;
  /** "3 to fix", "4 to look at", "All clear", "Not checked yet". */
  label: string;
  tone: "rec" | "warn" | "ok" | "plain";
  errors: number;
  warnings: number;
  joins: number;
}

export interface Checkable {
  check?: { errors: string[]; warnings: string[] } | null;
  joins?: { flagged: number } | null;
}

/** Join warnings are written into qc.md too, but they're listed (and counted) from joins.json. */
export const isJoinWarning = (w: string) => / join: /.test(w);

export function versionStatus(v: Checkable | null | undefined): Status {
  const errors = v?.check?.errors.length ?? 0;
  const warnings = v?.check ? v.check.warnings.filter((w) => !isJoinWarning(w)).length : 0;
  const joins = v?.joins?.flagged ?? 0;
  const looks = warnings + joins;
  const base = { errors, warnings, joins };
  if (errors) return { kind: "fix", count: errors, label: `${errors} to fix`, tone: "rec", ...base };
  if (looks) return { kind: "look", count: looks, label: `${looks} to look at`, tone: "warn", ...base };
  if (!v?.check && !v?.joins) return { kind: "unchecked", count: 0, label: "Not checked yet", tone: "plain", ...base };
  return { kind: "clear", count: 0, label: "All clear", tone: "ok", ...base };
}

/** What the Start screen's machine check says, in one place. `null` means it hasn't come back yet. */
export interface DoctorLike { engine: boolean; checks: { ok: boolean; required: boolean }[]; error?: string; install?: string }
export type DoctorStatus =
  | { kind: "checking"; headline: string }
  | { kind: "down"; headline: string; error: string; install: string }
  | { kind: "missing" | "ready"; headline: string };

export function doctorStatus(doc: DoctorLike | null): DoctorStatus {
  if (!doc) return { kind: "checking", headline: "Checking…" };
  if (!doc.engine || doc.checks.length === 0) {
    return { kind: "down", headline: "Couldn't run yap-machine", error: doc.error?.trim() || "It didn't answer.", install: doc.install ?? "./scripts/install" };
  }
  const ready = doc.checks.filter((c) => c.ok).length;
  const missing = doc.checks.some((c) => c.required && !c.ok);
  return { kind: missing ? "missing" : "ready", headline: `${ready} of ${doc.checks.length} tools ready` };
}

/** A note's place in its life, in words, for the note list, the timeline dots and the compare panel. */
export type NoteKey = "waiting" | "sent" | "check" | "resolved";
export interface NoteLike { status: string; fixedIn?: string; reopened?: number }
export function noteState(n: NoteLike): { key: NoteKey; label: string; tone: "rec" | "warn" | "plain" } {
  if (n.status === "sent") return { key: "sent", label: "With your agent", tone: "plain" };
  if (n.status === "done") return { key: "check", label: `Fixed${n.fixedIn ? ` in ${n.fixedIn}` : ""}: check it`, tone: "warn" };
  if (n.status === "resolved") return { key: "resolved", label: "Resolved", tone: "plain" };
  return { key: "waiting", label: n.reopened ? "Sent back, waiting to send" : "Waiting to send", tone: "rec" };
}

export type NoteFilter = "all" | NoteKey;
export const NOTE_FILTERS: [NoteFilter, string][] = [["all", "All"], ["waiting", "Waiting"], ["sent", "With agent"], ["check", "To check"], ["resolved", "Resolved"]];

export function noteCounts(notes: NoteLike[]): Record<NoteFilter, number> {
  const c: Record<NoteFilter, number> = { all: notes.length, waiting: 0, sent: 0, check: 0, resolved: 0 };
  for (const n of notes) c[noteState(n).key]++;
  return c;
}
export const filterNotes = <T extends NoteLike>(notes: T[], f: NoteFilter): T[] => (f === "all" ? notes : notes.filter((n) => noteState(n).key === f));
/** Notes still asking for something: everything except resolved. */
export const unresolved = <T extends NoteLike>(notes: T[]): T[] => notes.filter((n) => n.status !== "resolved");
