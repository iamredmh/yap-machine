import { describe, expect, it } from "vitest";
import { longRunningCommand, main, selectedHarnesses, supportedNode } from "./main.js";

describe("source CLI options", () => {
  it("accepts the same agent IDs through repeated or comma-separated --only options", () => {
    expect(selectedHarnesses(["codex,cursor", "codex", "claude-code"])).toEqual(["codex", "cursor", "claude-code"]);
    expect(selectedHarnesses(undefined)).toBeUndefined();
    expect(() => selectedHarnesses(["unknown"])).toThrow(/Choose claude-code, codex, cursor, claude-desktop, gemini/);
    expect(() => selectedHarnesses([""])).toThrow(/empty/);
  });
  it("requires Node 22.12 consistently with the source build", () => {
    for (const version of ["20.19.0", "22.0.0", "22.11.9", "invalid"]) expect(supportedNode(version)).toBe(false);
    for (const version of ["22.12.0", "22.18.0", "24.0.0"]) expect(supportedNode(version)).toBe(true);
  });
  it("documents the local route without running setup", async () => {
    const output: string[] = [];
    expect(await main(["--help"], { out: text => output.push(text), err: text => output.push(text), cwd: "/unused" })).toBe(0);
    expect(output.join("\n")).toContain("setup --local --dry-run");
    expect(output.join("\n")).toContain("--only codex");
    expect(output.join("\n")).not.toContain("npx yap-machine");
    expect(longRunningCommand(["setup", "--local", "--only", "codex"])).toBe(false);
    expect(longRunningCommand(["mcp"])).toBe(true);
  });
});
