import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setup, type SetupEnv } from "./setup.js";

describe("source setup in an isolated home", () => {
  let temp: string, env: SetupEnv;
  beforeEach(async () => {
    temp = await mkdtemp(join(tmpdir(), "yap-local-setup-"));
    const home = join(temp, "home"), cliFile = join(temp, "Source checkout", "desk", "dist", "cli", "index.js");
    const skillFile = join(temp, "SKILL.md");
    await mkdir(dirname(cliFile), { recursive: true });
    await writeFile(cliFile, "// built CLI fixture\n");
    await writeFile(skillFile, "---\nname: yap-machine\ndescription: local editing\n---\n# Editing\nRun yap-machine doctor.\n");
    for (const directory of [".codex", ".cursor", ".claude"]) await mkdir(join(home, directory), { recursive: true });
    env = { home, platform: "darwin", cliFile, nodeExecutable: process.execPath, skillFile, which: async () => false, exec: async () => { throw new Error("Unexpected external command"); } };
  });
  afterEach(async () => { await rm(temp, { recursive: true, force: true }); });

  it("dry-run names the absolute launcher and leaves configs and skills untouched", async () => {
    const config = join(env.home, ".codex", "config.toml"), original = 'model = "existing"\n';
    await writeFile(config, original);
    const results = await setup(env, { local: true, only: ["codex"], dryRun: true });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ harness: "codex", status: "would-add", skill: "would-add" });
    expect(results[0].detail).toContain(env.cliFile);
    expect(await readFile(config, "utf8")).toBe(original);
    await expect(access(config + ".yap-machine.bak")).rejects.toThrow();
    await expect(access(join(env.home, ".codex", "skills", "yap-machine", "SKILL.md"))).rejects.toThrow();
    await expect(access(join(env.home, ".cursor", "mcp.json"))).rejects.toThrow();
  });

  it("updates only the chosen agent, backs up its configuration, and installs a source-aware skill once", async () => {
    const config = join(env.home, ".codex", "config.toml");
    const original = 'model = "existing"\n\n[mcp_servers.yap-machine]\ncommand = "npx"\nargs = ["-y", "yap-machine", "mcp"]\n';
    await writeFile(config, original);
    expect((await setup(env, { local: true, only: ["codex"] }))[0]).toMatchObject({ status: "added", skill: "added" });
    const next = await readFile(config, "utf8");
    expect(next).toContain(`command = ${JSON.stringify(process.execPath)}`);
    expect(next).toContain(JSON.stringify(env.cliFile));
    expect(next).not.toContain('command = "npx"');
    expect(await readFile(config + ".yap-machine.bak", "utf8")).toBe(original);
    const skill = await readFile(join(env.home, ".codex", "skills", "yap-machine", "SKILL.md"), "utf8");
    expect(skill.startsWith("---\nname: yap-machine")).toBe(true);
    expect(skill).toContain(join(temp, "Source checkout", "scripts", "yap-machine"));
    expect(skill).toContain("No global engine command or registry package is needed");
    expect((await setup(env, { local: true, only: ["codex"] }))[0]).toMatchObject({ status: "already", skill: "already" });
    expect(await readFile(config + ".yap-machine.bak", "utf8")).toBe(original);
    await expect(access(join(env.home, ".cursor", "mcp.json"))).rejects.toThrow();
  });

  it("does not write anything when the source CLI has not been built", async () => {
    await expect(setup({ ...env, cliFile: join(temp, "missing.js") }, { local: true, only: ["codex"] })).rejects.toThrow(/built Desk CLI is missing/);
    await expect(access(join(env.home, ".codex", "config.toml"))).rejects.toThrow();
  });

  it("previews a Claude npm-to-local migration without running its mutating CLI commands", async () => {
    const calls: string[][] = [];
    const claude = { ...env, which: async (cmd: string) => cmd === "claude", exec: async (_cmd: string, args: string[]) => { calls.push(args); return { code: 0, out: "Command: npx\nArgs: -y yap-machine mcp\n" }; } };
    const results = await setup(claude, { local: true, only: ["claude-code"], dryRun: true });
    expect(results[0].status).toBe("would-add");
    expect(results[0].detail).toContain(env.cliFile);
    expect(calls).toEqual([["mcp", "get", "yap-machine"]]);
    await expect(access(join(env.home, ".claude", "skills", "yap-machine", "SKILL.md"))).rejects.toThrow();
  });

  it("recognizes an existing Claude local launcher and avoids registering it again", async () => {
    const calls: string[][] = [];
    const claude = { ...env, which: async (cmd: string) => cmd === "claude", exec: async (_cmd: string, args: string[]) => { calls.push(args); return { code: 0, out: `Command: ${process.execPath}\nArgs: ${env.cliFile} mcp\n` }; } };
    expect((await setup(claude, { local: true, only: ["claude-code"], dryRun: true }))[0].status).toBe("already");
    expect(calls).toEqual([["mcp", "get", "yap-machine"]]);
  });
});
