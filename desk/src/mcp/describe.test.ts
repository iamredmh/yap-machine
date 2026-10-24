import { expect, it } from "vitest";
import { describe as describeBatch } from "./tools.js";

it("tells the agent when a note came back not fixed, with what it said last time", () => {
  const text = describeBatch({ id: "b1", project: "p1", version: "v5", notes: [
    { id: "n1", version: "v4", at: 12, text: "tighten the hook" },
    { id: "n2", version: "v4", at: 40, text: "name is misspelt", reopened: 1, reply: "fixed the spelling", fixedIn: "v5" },
  ], messages: [], look: [], files: [] }, "/w");
  expect(text).toContain("[n1] v4 at 0:12: tighten the hook");
  expect(text).toContain("[n2] v4 at 0:40: name is misspelt");
  expect(text).toContain('NOT FIXED (sent back). Your last reply (in v5): "fixed the spelling"');
  expect(text.split("NOT FIXED")).toHaveLength(2);   // only the sent-back note
});
