import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { startServer } from "../server/start.js";
import { defaultHome, ensureServer, findServer } from "../mcp/ensure.js";
import { openBrowser, runStdio } from "../mcp/stdio.js";
import { DeskClient } from "../mcp/client.js";
import { runEngine, runtimeEnvironment } from "../core/engine.js";
import { setup } from "../setup/setup.js";
import { realSetupEnv } from "../setup/env.js";
import { HARNESS_IDS, type HarnessId } from "../setup/harnesses.js";
import { VERSION } from "../mcp/tools.js";
import { describeLan } from "./phone.js";
import type { LanInfo } from "../server/lan.js";

export interface Io { out(l: string): void; err(l: string): void; cwd: string }

const OPTIONS = {
  home: { type: "string" },
  port: { type: "string" },
  "idle-minutes": { type: "string" },
  "no-browser": { type: "boolean" },
  lan: { type: "boolean" },
  "dry-run": { type: "boolean" },
  local: { type: "boolean" },
  only: { type: "string", multiple: true },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
} as const;

const LONG_RUNNING = ["serve", "mcp"];

export function longRunningCommand(argv: string[]): boolean {
  try {
    const [cmd] = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true }).positionals;
    return LONG_RUNNING.includes(cmd ?? "");
  } catch {
    return false;
  }
}

const HELP = `Yap Machine ${VERSION}: point your agent at your talking-head footage, review the cut here.

From a source checkout (Node 22.12+):
  ./scripts/install              install the local engine and build the desk
  ./scripts/start-desk ~/Yap      open your local workspace
  node desk/dist/cli/index.js     open the desk (starts it if needed)
  node desk/dist/cli/index.js setup --local --dry-run
                                 preview agent configuration and skill changes
  node desk/dist/cli/index.js setup --local --only codex
                                 register this checkout with a selected agent
  node desk/dist/cli/index.js doctor
                                 check the local tools Yap Machine uses

Other commands: phone (same-Wi-Fi review), phone off, stop, serve DIR, mcp.
The agent starts mcp itself. A future package install can use yap-machine-desk
instead of node desk/dist/cli/index.js; setup without --local retains that package launch.

  --home DIR     the workspace folder for your projects (default: $YAP_HOME or ~/Yap)
                 with setup: save this workspace in the agent's MCP launch
  --no-browser   don't open the browser
  --lan          with serve: also open the desk to your phone on the local network (prints a QR code)
  --local        with setup: use this checkout's absolute Node and built CLI paths
  --only ID      with setup: select agents; repeat or use commas (${HARNESS_IDS.join(", ")})
  --dry-run      with setup: show changes without writing configurations or skills

Or just tell your agent: "Edit my videos with Yap Machine: https://github.com/iamredmh/yap-machine"`;

export function supportedNode(version: string): boolean {
  const [major, minor] = version.split(".").map(Number);
  return major > 22 || (major === 22 && minor >= 12);
}

export function selectedHarnesses(values?: string[]): HarnessId[] | undefined {
  if (!values) return undefined;
  const ids = [...new Set(values.flatMap(value => value.split(",").map(id => id.trim())))];
  const invalid = ids.filter(id => !HARNESS_IDS.includes(id as HarnessId));
  if (invalid.length) throw new Error(`Unknown agent: ${invalid.map(id => id || "(empty)").join(", ")}. Choose ${HARNESS_IDS.join(", ")}.`);
  return ids as HarnessId[];
}

export async function main(argv: string[], io: Io): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  } catch (e) {
    io.err((e as Error).message);
    return 2;
  }
  const { values, positionals } = parsed;
  const [cmd = "open", arg] = positionals;
  if (values.version) { io.out(VERSION); return 0; }
  if (values.help || cmd === "help") { io.out(HELP); return 0; }
  if (!supportedNode(process.versions.node)) { io.err(`Yap Machine needs Node 22.12 or newer (found ${process.versions.node}). Update Node and rerun ./scripts/install.`); return 1; }
  if (cmd !== "setup" && (values.local || values.only || values["dry-run"])) { io.err("--local, --only and --dry-run are setup options."); return 2; }
  // The local MCP entry uses an absolute Node executable. Its server and tools also
  // need the checkout's venv and the standard macOS package-manager directories.
  const env = runtimeEnvironment();
  if (env.PATH) process.env.PATH = env.PATH;
  if (env.Path) process.env.Path = env.Path;
  const home = values.home ? resolve(values.home.replace(/^~(?=$|\/)/, homedir())) : defaultHome();

  switch (cmd) {
    case "open": {
      const c = await ensureServer(home);
      io.out(`Yap Machine desk: ${c.baseUrl}/  (workspace ${home})`);
      if (!values["no-browser"]) openBrowser(c.baseUrl + "/");
      return 0;
    }
    case "serve": {
      const dir = arg ? resolve(arg) : home;
      const idle = values["idle-minutes"] ? Number(values["idle-minutes"]) * 60000 : undefined;
      const running = await startServer(dir, { port: values.port ? Number(values.port) : undefined, idleMs: idle });
      io.out(`Yap Machine desk on ${running.url}/ for ${running.store.root}`);
      if (values.lan) {
        try { for (const l of describeLan(await running.lan.enable())) io.out(l); }
        catch (e) { io.err(`Phone access didn't start: ${(e as Error).message}`); }
      }
      const stop = () => void running.close().then(() => process.exit(0));
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
      await running.closed;
      return 0;
    }
    case "phone": {
      const c = await ensureServer(home);
      try {
        const info = await c.post<LanInfo>("/api/lan", { on: arg !== "off" });
        for (const l of describeLan(info)) io.out(l);
        return 0;
      } catch (e) {
        io.err((e as Error).message);
        return 1;
      }
    }
    case "mcp":
      await runStdio(home);
      return 0;
    case "stop": {
      const url = await findServer(home);
      if (!url) { io.out("The desk isn't running."); return 0; }
      await new DeskClient(url).post("/api/shutdown", {});
      io.out("Stopped the desk.");
      return 0;
    }
    case "doctor": {
      io.out(`  ✓ Node ${process.versions.node.padEnd(14)} runs this desk (22.12+ required)`);
      const r = await runEngine(["doctor"], (l) => io.out(l));
      if (r.code === 127) io.out("  ✗ The local engine isn't ready. Run ./scripts/install from the source checkout, then retry.");
      return r.code === 0 ? 0 : 1;
    }
    case "setup": {
      try {
        const only = selectedHarnesses(values.only);
        const workspace = values.home !== undefined || process.env.YAP_HOME ? home : undefined;
        const results = await setup(realSetupEnv(), { dryRun: values["dry-run"], local: values.local, only, workspace });
        for (const r of results) io.out(`  ${r.status === "added" || r.status === "already" ? "✓" : r.status === "not-found" ? "·" : r.status === "would-add" ? "+" : "✗"} ${r.name}: ${r.detail}`);
        if (values["dry-run"]) io.out("\nDry run complete. No configuration or skill files were changed.");
        else if (results.some(r => r.status === "added" || r.status === "already")) io.out("\nStart a fresh agent session, then say: \"Edit my videos with Yap Machine\" and give the footage location.");
        if (results.every(r => r.status === "not-found")) { io.err("No selected agent was found. Install one of the supported agents, then rerun setup."); return 1; }
        return results.some(r => r.status === "failed" || (only && r.status === "not-found")) ? 1 : 0;
      } catch (e) { io.err((e as Error).message); return 2; }
    }
    default:
      io.err(`Unknown command "${cmd}".\n\n${HELP}`);
      return 2;
  }
}
