import { describe, expect, it } from "vitest";
import { doctorStatus, versionStatus } from "./status.js";

const check = (errors: string[] = [], warnings: string[] = []) => ({ errors, warnings, summary: [] });

describe("versionStatus", () => {
  it("says 'N to fix' for errors, even when there are looks too", () => {
    const s = versionStatus({ check: check(["a", "b"], ["w"]), joins: { flagged: 3 } });
    expect(s).toMatchObject({ kind: "fix", count: 2, label: "2 to fix", tone: "rec" });
  });
  it("counts non-join warnings and flagged joins together as 'to look at'", () => {
    const s = versionStatus({ check: check([], ["loud cut at 0:12", "v5 join: 1:03 repeats a word", "v5 join: 2:00 breath"]), joins: { flagged: 3 } });
    expect(s).toMatchObject({ kind: "look", count: 4, label: "4 to look at", tone: "warn", warnings: 1, joins: 3 });
  });
  it("does not count a join twice when it is in qc.md and in the join report", () => {
    expect(versionStatus({ check: check([], ["00:30.00 join: unclear"]), joins: { flagged: 1 } }).count).toBe(1);
  });
  it("is all clear only when nothing is wrong and something was checked", () => {
    expect(versionStatus({ check: check(), joins: { flagged: 0 } })).toMatchObject({ kind: "clear", label: "All clear", tone: "ok", count: 0 });
    expect(versionStatus({ check: check(), joins: null }).kind).toBe("clear");
  });
  it("says it hasn't been checked rather than all clear when there is nothing to read", () => {
    expect(versionStatus({ check: null, joins: null })).toMatchObject({ kind: "unchecked", label: "Not checked yet" });
    expect(versionStatus(null).kind).toBe("unchecked");
  });
  it("still counts flagged joins when only the join report exists", () => {
    expect(versionStatus({ check: null, joins: { flagged: 2 } })).toMatchObject({ kind: "look", count: 2 });
  });
});

describe("doctorStatus", () => {
  it("never says '0 of 0 tools ready': no engine, or no checks, is 'Couldn't run yap-machine' with the error and the install line", () => {
    for (const doc of [{ engine: false, checks: [], error: "spawn x ENOENT" }, { engine: true, checks: [] }]) {
      const s = doctorStatus(doc);
      expect(s.kind).toBe("down");
      expect(s.headline).toBe("Couldn't run yap-machine");
      if (s.kind === "down") expect(s.install).toBe("./scripts/install");
    }
    const down = doctorStatus({ engine: false, checks: [], error: "spawn x ENOENT" });
    expect(down.kind === "down" && down.error).toBe("spawn x ENOENT");
  });
  it("counts ready tools, and flags a missing required one", () => {
    expect(doctorStatus({ engine: true, checks: [{ ok: true, required: true }, { ok: false, required: false }] })).toEqual({ kind: "ready", headline: "1 of 2 tools ready" });
    expect(doctorStatus({ engine: true, checks: [{ ok: true, required: true }, { ok: false, required: true }] }).kind).toBe("missing");
  });
  it("is 'Checking…' until the answer comes", () => { expect(doctorStatus(null).kind).toBe("checking"); });
});

import { NOTE_FILTERS, filterNotes, noteCounts, noteState, unresolved } from "./status.js";

describe("a note's state", () => {
  it("says where each note is in its life", () => {
    expect(noteState({ status: "open" })).toEqual({ key: "waiting", label: "Waiting to send", tone: "rec" });
    expect(noteState({ status: "open", reopened: 1 }).label).toBe("Sent back, waiting to send");
    expect(noteState({ status: "sent" })).toMatchObject({ key: "sent", label: "With your agent" });
    expect(noteState({ status: "done", fixedIn: "v5" })).toMatchObject({ key: "check", label: "Fixed in v5: check it", tone: "warn" });
    expect(noteState({ status: "done" }).label).toBe("Fixed: check it");
    expect(noteState({ status: "resolved" })).toMatchObject({ key: "resolved", label: "Resolved" });
  });
  it("counts and filters by state, and keeps resolved notes out of the to-do", () => {
    const ns = [{ status: "open" }, { status: "open" }, { status: "sent" }, { status: "done" }, { status: "resolved" }];
    expect(noteCounts(ns)).toEqual({ all: 5, waiting: 2, sent: 1, check: 1, resolved: 1 });
    expect(filterNotes(ns, "waiting")).toHaveLength(2);
    expect(filterNotes(ns, "all")).toHaveLength(5);
    expect(unresolved(ns)).toHaveLength(4);
    expect(NOTE_FILTERS.map(([k]) => k)).toEqual(["all", "waiting", "sent", "check", "resolved"]);
  });
});
