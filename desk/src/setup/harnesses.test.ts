import { describe, expect, it } from "vitest";
import { localMcpLaunch, mcpLaunch, mergeJson, mergeToml } from "./harnesses.js";

describe("Codex config (TOML)", () => {
  it("adds a valid table, keeps the user's own settings, and does not add it twice", () => {
    const user = 'model = "o3"\n\n[mcp_servers.other]\ncommand = "x"\n';
    const once = mergeToml(user);
    expect(once.changed).toBe(true);
    expect(once.text).toContain("[mcp_servers.yap-machine]");
    expect(once.text).not.toContain('["yap-machine"]');
    expect(once.text).toContain('model = "o3"');
    expect(once.text).toContain("[mcp_servers.other]");
    const again = mergeToml(once.text);
    expect(again.changed).toBe(false);
    expect(again.text).toBe(once.text);
    expect(once.text.match(/yap-machine/g)).toHaveLength(2);   // the table name, and the package name in args
  });

  it("creates the file from nothing, and updates an entry that points somewhere else", () => {
    const fresh = mergeToml(null);
    expect(fresh.text.startsWith("[mcp_servers.yap-machine]")).toBe(true);
    const old = '[mcp_servers.yap-machine]\ncommand = "node"\nargs = ["old.js"]\n\n[other]\na = 1\n';
    const next = mergeToml(old);
    expect(next.changed).toBe(true);
    expect(next.text).toContain('command = "npx"');
    expect(next.text).toContain("[other]");
    expect(next.text.match(/\[mcp_servers\.yap-machine\]/g)).toHaveLength(1);
  });
});

describe("JSON agent configs", () => {
  it("adds the server beside existing ones and is idempotent", () => {
    const user = JSON.stringify({ mcpServers: { other: { command: "x" } }, keep: 1 });
    const once = mergeJson(user);
    expect(JSON.parse(once.text).mcpServers.other).toEqual({ command: "x" });
    expect(JSON.parse(once.text).mcpServers["yap-machine"].args).toEqual(["-y", "yap-machine", "mcp"]);
    expect(JSON.parse(once.text).keep).toBe(1);
    expect(mergeJson(once.text).changed).toBe(false);
  });
});

describe("local checkout registrations", () => {
  const launch = localMcpLaunch("/opt/node tools/node", "/Users/creator/My Projects/yap-machine/desk/dist/cli/index.js");
  it("keeps executable paths as distinct arguments, without a shell or registry lookup", () => {
    expect(launch).toEqual({ command: "/opt/node tools/node", args: ["/Users/creator/My Projects/yap-machine/desk/dist/cli/index.js", "mcp"] });
    expect(() => localMcpLaunch("node", launch.args[0])).toThrow(/absolute/);
  });
  it("preserves spaces in an explicit workspace and rejects relative registrations", () => {
    expect(localMcpLaunch(launch.command, launch.args[0], "/work/My videos").args).toEqual([...launch.args, "--home", "/work/My videos"]);
    expect(() => localMcpLaunch(launch.command, launch.args[0], "relative")).toThrow(/absolute workspace/);
  });
  it("updates package launches only when an explicitly requested workspace differs", () => {
    const original = JSON.stringify({ mcpServers: { "yap-machine": { command: "/opt/node/npx", args: ["-y", "yap-machine@0.1.0", "mcp", "--home", "/old"] } } });
    expect(mergeJson(original, mcpLaunch("darwin", "/old")).changed).toBe(false);
    const next = mergeJson(original, mcpLaunch("darwin", "/new"));
    expect(JSON.parse(next.text).mcpServers["yap-machine"].args.slice(-2)).toEqual(["--home", "/new"]);
    expect(mergeJson(next.text, mcpLaunch("darwin", "/new")).changed).toBe(false);
  });
  it("replaces an npm JSON launch while retaining custom and unrelated configuration", () => {
    const original = JSON.stringify({ mcpServers: { "yap-machine": { command: "npx", args: ["-y", "yap-machine", "mcp"], env: { YAP_HOME: "/workspace" }, disabled: false }, other: { command: "other" } }, theme: "light" });
    const next = mergeJson(original, launch);
    expect(next.changed).toBe(true);
    expect(JSON.parse(next.text)).toEqual({ mcpServers: { "yap-machine": { ...launch, env: { YAP_HOME: "/workspace" }, disabled: false }, other: { command: "other" } }, theme: "light" });
    expect(mergeJson(next.text, launch)).toEqual({ changed: false, text: next.text });
  });
  it("replaces an npm TOML launch without removing timeouts, env or other servers", () => {
    const original = 'model = "example"\n\n[mcp_servers.yap-machine]\ncommand = "npx"\nargs = [\n  "-y",\n  "yap-machine",\n  "mcp",\n]\nstartup_timeout_sec = 60\nenv = { YAP_HOME = "/workspace" }\n\n[mcp_servers.other]\ncommand = "other"\n';
    const next = mergeToml(original, launch);
    expect(next.changed).toBe(true);
    expect(next.text).toContain('command = "/opt/node tools/node"');
    expect(next.text).toContain(`args = [${launch.args.map(a => JSON.stringify(a)).join(", ")}]`);
    expect(next.text).toContain('startup_timeout_sec = 60');
    expect(next.text).toContain('env = { YAP_HOME = "/workspace" }');
    expect(next.text).toContain('[mcp_servers.other]\ncommand = "other"');
    expect(mergeToml(next.text, launch)).toEqual({ changed: false, text: next.text });
  });
  it("leaves a pinned package registration intact when local setup was not requested", () => {
    const original = JSON.stringify({ mcpServers: { "yap-machine": { command: "/usr/local/bin/npx", args: ["-y", "yap-machine@0.1.0", "mcp"], env: { YAP_HOME: "/workspace" } } } });
    expect(mergeJson(original).changed).toBe(false);
  });
  it("refuses to rewrite an args expression it cannot parse safely", () => {
    const unusual = '[mcp_servers.yap-machine]\ncommand = "node"\nargs = ["/some/path]with-bracket/index.js", "mcp"]\n';
    expect(() => mergeToml(unusual, launch)).toThrow(/safely edit/);
  });
});
