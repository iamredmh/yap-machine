import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { engineCommand, runtimeEnvironment } from "./engine.js";

describe("source engine launch", () => {
  let root: string, fromDir: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "yap-engine-source-"));
    fromDir = join(root, "desk", "dist", "core");
    await mkdir(fromDir, { recursive: true });
    await mkdir(join(root, "src", "yap"), { recursive: true });
    await writeFile(join(root, "pyproject.toml"), '[project]\nname = "yap-machine"\n');
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it("uses the checkout venv directly even when a GUI PATH has no uv or global engine", async () => {
    const executable = join(root, ".venv", "bin", "yap-machine");
    await mkdir(join(root, ".venv", "bin"), { recursive: true });
    await writeFile(executable, "fixture");
    expect(engineCommand({ fromDir, env: { PATH: "/usr/bin:/bin" }, platform: "darwin" })).toEqual({ cmd: executable, args: [] });
    expect(engineCommand({ fromDir, env: { YAP_BIN: "/custom/engine" } })).toEqual({ cmd: "/custom/engine", args: [] });
  });
  it("retains uv before the checkout is installed, and PATH resolution outside a checkout", () => {
    expect(engineCommand({ fromDir, env: {} })).toEqual({ cmd: "uv", args: ["run", "--quiet", "--project", root, "yap-machine"] });
    expect(engineCommand({ fromDir: tmpdir(), env: {} })).toEqual({ cmd: "yap-machine", args: [] });
  });
  it("adds local tools to child PATH without modifying or recording the caller's environment", () => {
    const env = { PATH: "/usr/bin:/bin:/opt/homebrew/bin", EXAMPLE: "preserved" };
    const runtime = runtimeEnvironment({ fromDir, env, platform: "darwin", nodeExecutable: "/opt/node tools/node" });
    expect(runtime.PATH?.split(":")).toEqual(["/opt/node tools", join(root, ".venv", "bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"]);
    expect(runtime.EXAMPLE).toBe("preserved");
    expect(env.PATH).toBe("/usr/bin:/bin:/opt/homebrew/bin");
  });
});
