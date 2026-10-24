import { describe, expect, it } from "vitest";
import { fullLabel, versionLabel } from "./version-label.js";

describe("version chip labels", () => {
  it("says latest for the newest and the length when there are no notes", () => {
    expect(versionLabel(true, "v5: whatever", "3:33")).toBe("latest");
    expect(versionLabel(false, undefined, "3:33")).toBe("3:33");
    expect(versionLabel(false, "  ", "0:30")).toBe("0:30");
  });
  it("drops the leading version name and keeps a short note whole", () => {
    expect(versionLabel(false, "v2: tighter hook", "3:33")).toBe("tighter hook");
    expect(versionLabel(false, "v3 = approved v2", "3:33")).toBe("approved v2");
    expect(fullLabel("v4= v3 + the synced screen recording")).toBe("v3 + the synced screen recording");
  });
  it("cuts a long one at a word, with an ellipsis, never in the middle of a word", () => {
    const a = versionLabel(false, "v3 = approved v2 + captions and a name card", "3:33");
    expect(a).toBe("approved v2 + captions…");
    const b = versionLabel(false, "v4 = v3 + the synced screen recording", "3:33");
    expect(b).toBe("v3 + the synced screen…");
    for (const l of [a, b]) expect(/\w…$/.test(l) || l.endsWith("…")).toBe(true);
  });
  it("uses the first clause when the note has a colon or a full stop", () => {
    expect(versionLabel(false, "v2 self-review of v1 QC: fixed two cuts and a caption", "3:33")).toBe("self-review of v1 QC…");
    expect(versionLabel(false, "Shorter. Cut the middle.", "3:33")).toBe("Shorter…");
  });
  it("copes with one very long word", () => {
    const l = versionLabel(false, "x".repeat(60), "3:33");
    expect(l.length).toBeLessThanOrEqual(27);
    expect(l.endsWith("…")).toBe(true);
  });
});
