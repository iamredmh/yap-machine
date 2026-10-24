import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { harnesses, localMcpLaunch, mcpLaunch, mentionsLegacySource, mergeJson, mergeToml, type Harness, type HarnessId, type McpLaunch } from "./harnesses.js";

export interface SetupEnv {
  home: string;
  platform: NodeJS.Platform;
  appData?: string;
  /** Is this command on PATH? */
  which(cmd: string): Promise<boolean>;
  /**
   * Run a command in `cwd`; resolve with exit code and output. With `timeout` (ms), the command
   * gets no stdin and is killed once the time is up, resolving with `timedOut: true`.
   */
  exec(cmd: string, args: string[], cwd: string, opts?: { timeout?: number }): Promise<{ code: number; out: string; timedOut?: boolean }>;
  /** Path of the SKILL.md to install. Defaults to the one shipped in this package. */
  skillFile?: string;
  /** Override only for a packaged launcher or a fixture. Normal local setup uses this Node and the checkout's built CLI. */
  nodeExecutable?: string;
  cliFile?: string;
}

export interface SetupOptions {
  only?: HarnessId[];
  dryRun?: boolean;
  local?: boolean;
}

export interface SetupResult {
  harness: HarnessId;
  name: string;
  status: "added" | "already" | "not-found" | "failed" | "would-add";
  detail: string;
  skill?: "added" | "already" | "would-add";
}

const exists = (p: string) => access(p).then(() => true, () => false);

export function packagedSkill(): string {
  return fileURLToPath(new URL("../../skills/yap-machine/SKILL.md", import.meta.url));
}

export function builtCliFile(): string {
  return fileURLToPath(new URL("../../dist/cli/index.js", import.meta.url));
}

const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
const describeCommand = (launch: McpLaunch) => [launch.command, ...launch.args].map(quote).join(" ");

/** Local agents need explicit commands; GUI sessions may not inherit a terminal's PATH. */
function skillForLaunch(text: string, launch?: McpLaunch): string {
  if (!launch) return text;
  const root = resolve(dirname(launch.args[0]), "../../..");
  const section = `\n## This local installation\n\nSource checkout: \`${root}\`. Keep this folder in place.\n\nWhen these instructions say \`yap-machine\`, run \`${quote(join(root, "scripts", "yap-machine"))}\` instead. No global engine command or registry package is needed.\n\nThe local Desk/MCP command is \`${describeCommand(launch)}\`. The registered agent starts it automatically. If the checkout or Node installation moves, rerun local setup.\n\n`;
  const frontmatter = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(text);
  return frontmatter ? frontmatter[0] + section + text.slice(frontmatter[0].length) : section.trimStart() + text;
}

async function installed(h: Harness, env: SetupEnv): Promise<boolean> {
  return (await exists(h.marker)) || (h.bin ? await env.which(h.bin) : false);
}

async function writeConfig(path: string, text: string, existed: boolean): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  if (existed) await copyFile(path, `${path}.yap-machine.bak`);
  await writeFile(path, text, "utf8");
}

async function installSkill(h: Harness, env: SetupEnv, dryRun: boolean, localLaunch?: McpLaunch): Promise<SetupResult["skill"]> {
  if (!h.skillDir) return undefined;
  const target = join(h.skillDir, "SKILL.md");
  const source = env.skillFile ?? packagedSkill();
  const want = skillForLaunch(await readFile(source, "utf8"), localLaunch);
  const have = await readFile(target, "utf8").catch(() => null);
  if (have === want) return "already";
  if (dryRun) return "would-add";
  await mkdir(h.skillDir, { recursive: true });
  await writeFile(target, want, "utf8");
  return "added";
}

async function one(h: Harness, env: SetupEnv, dryRun: boolean, launch: McpLaunch, local: boolean): Promise<SetupResult> {
  const base = { harness: h.id, name: h.name };
  if (!(await installed(h, env))) return { ...base, status: "not-found", detail: "not installed" };
  const command = [launch.command, ...launch.args];
  const launchText = describeCommand(launch);
  try {
    if (h.kind === "claude-cli") {
      if (!(await env.which("claude"))) return { ...base, status: "failed", detail: "the claude command isn't on PATH. Run: claude mcp add --scope user yap-machine -- " + launchText };
      // Run from home so a project's own .mcp.json can't make it look registered.
      const got = await env.exec("claude", ["mcp", "get", "yap-machine"], env.home);
      const skill = await installSkill(h, env, dryRun, local ? launch : undefined);
      if (got.code === 0) {
        const sameLocal = /^\s*Command:\s*(.+)$/mi.exec(got.out)?.[1].trim() === launch.command
          && /^\s*Args:\s*(.*)$/mi.exec(got.out)?.[1].trim() === launch.args.join(" ");
        if (local ? sameLocal : !mentionsLegacySource(got.out)) return { ...base, status: "already", detail: `yap-machine MCP server already registered: ${launchText}`, skill };
        if (dryRun) return { ...base, status: "would-add", detail: "replace the user-scoped yap-machine MCP launch with " + launchText, skill };
        const removed = await env.exec("claude", ["mcp", "remove", "--scope", "user", "yap-machine"], env.home);
        if (removed.code !== 0) return { ...base, status: "failed", detail: removed.out.trim() || "claude mcp remove failed", skill };
        const added = await env.exec("claude", ["mcp", "add", "--scope", "user", "yap-machine", "--", ...command], env.home);
        if (added.code !== 0) return { ...base, status: "failed", detail: added.out.trim() || "claude mcp add failed", skill };
        return { ...base, status: "added", detail: `updated the user-scoped MCP launch: ${launchText}`, skill };
      }
      if (dryRun) return { ...base, status: "would-add", detail: "claude mcp add --scope user yap-machine -- " + launchText, skill };
      const add = await env.exec("claude", ["mcp", "add", "--scope", "user", "yap-machine", "--", ...command], env.home);
      if (add.code !== 0) return { ...base, status: "failed", detail: add.out.trim() || "claude mcp add failed", skill };
      return { ...base, status: "added", detail: "registered with claude mcp add --scope user", skill };
    }
    const path = h.config!;
    const existed = await exists(path);
    const before = existed ? await readFile(path, "utf8") : null;
    const merged = h.kind === "toml" ? mergeToml(before, launch) : mergeJson(before, launch);
    const skill = await installSkill(h, env, dryRun, local ? launch : undefined);
    if (!merged.changed) return { ...base, status: "already", detail: path, skill };
    if (dryRun) return { ...base, status: "would-add", detail: `${path}\n    command: ${launchText}`, skill };
    await writeConfig(path, merged.text, existed);
    return { ...base, status: "added", detail: existed ? `${path} (backup: ${path}.yap-machine.bak)` : path, skill };
  } catch (e) {
    return { ...base, status: "failed", detail: `${h.config ?? h.name}: ${(e as Error).message}` };
  }
}

/** Register the Yap Machine MCP server (and skill, where supported) with every installed harness. */
export async function setup(env: SetupEnv, opts: SetupOptions = {}): Promise<SetupResult[]> {
  const launch = opts.local ? localMcpLaunch(env.nodeExecutable ?? process.execPath, env.cliFile ?? builtCliFile()) : mcpLaunch(env.platform);
  if (opts.local && !(await exists(launch.args[0]))) throw new Error("The built Desk CLI is missing. Run ./scripts/install from the source checkout first.");
  const list = harnesses(env.home, env.platform, env.appData).filter((h) => !opts.only || opts.only.includes(h.id));
  const out: SetupResult[] = [];
  for (const h of list) out.push(await one(h, env, !!opts.dryRun, launch, !!opts.local));
  return out;
}
