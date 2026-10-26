import { isAbsolute, join } from "node:path";

/** Package source retained for a future registry installation; source checkouts use --local. */
export const SOURCE = "yap-machine";
/**
 * Older `npx` sources that already-registered harnesses may still be using, from before the
 * npm publish. `setup` and `doctor` recognise these as Yap Machine too, and `setup` migrates a
 * registration that uses one of them to `SOURCE` in place, rather than adding a duplicate.
 */
export const LEGACY_SOURCES: string[] = [];
/** The detail `doctor` reports for a harness still registered through a legacy source. */
export const LEGACY_DETAIL = "registered with an older launch. Run the source checkout's setup --local to update it.";
/** The launch everywhere except Windows. */
export const MCP_COMMAND = "npx";
export const MCP_ARGS = ["-y", SOURCE, "mcp"];

export interface McpLaunch {
  command: string;
  args: string[];
}

/**
 * How a harness should start the Yap Machine MCP server on this platform, from a given `npx` source.
 * On Windows npx is a .cmd script, which harnesses can't spawn directly, so it goes through cmd /c.
 */
function launchFor(platform: NodeJS.Platform, source: string): McpLaunch {
  const args = ["-y", source, "mcp"];
  return platform === "win32" ? { command: "cmd", args: ["/c", MCP_COMMAND, ...args] } : { command: MCP_COMMAND, args };
}

/** How a harness should start the Yap Machine MCP server on this platform, from the current `SOURCE`. */
export function mcpLaunch(platform: NodeJS.Platform, workspace?: string): McpLaunch {
  return withWorkspace(launchFor(platform, SOURCE), workspace);
}

function withWorkspace(launch: McpLaunch, workspace?: string): McpLaunch {
  if (workspace === undefined) return launch;
  if (!isAbsolute(workspace)) throw new Error("Agent setup needs an absolute workspace path.");
  return { ...launch, args: [...launch.args, "--home", workspace] };
}

/** Launch the built checkout directly, without npx, a registry, or a GUI app's Node PATH. */
export function localMcpLaunch(nodeExecutable: string, cliFile: string, workspace?: string): McpLaunch {
  if (!isAbsolute(nodeExecutable) || !isAbsolute(cliFile)) throw new Error("Local setup needs absolute Node and built CLI paths.");
  return withWorkspace({ command: nodeExecutable, args: [cliFile, "mcp"] }, workspace);
}

/** The same launch shapes, one per `LEGACY_SOURCES` entry, for recognising an existing registration. */
export function legacyMcpLaunches(platform: NodeJS.Platform): McpLaunch[] {
  return LEGACY_SOURCES.map((source) => launchFor(platform, source));
}

/** Does this text (e.g. `claude mcp get yap-machine` output) name a legacy `npx` source? */
export function mentionsLegacySource(text: string): boolean {
  return LEGACY_SOURCES.some((source) => text.includes(source));
}

const DEFAULT_LAUNCH: McpLaunch = { command: MCP_COMMAND, args: MCP_ARGS };

/** The harnesses setup knows, in the order it lists them. */
export const HARNESS_IDS = ["claude-code", "codex", "cursor", "claude-desktop", "gemini"] as const;
export type HarnessId = (typeof HARNESS_IDS)[number];

export interface Harness {
  id: HarnessId;
  name: string;
  /** How Yap Machine gets registered. */
  kind: "claude-cli" | "json" | "toml";
  /** Config file (json/toml kinds). */
  config?: string;
  /** Folder whose presence means the harness is installed. */
  marker: string;
  /** CLI on PATH that also means the harness is installed. */
  bin?: string;
  /** Where to copy the Yap Machine skill, if the harness reads skills. */
  skillDir?: string;
}

export function harnesses(home: string, platform: NodeJS.Platform, appData = join(home, "AppData", "Roaming")): Harness[] {
  const desktopDir =
    platform === "darwin"
      ? join(home, "Library", "Application Support", "Claude")
      : platform === "win32"
        ? join(appData, "Claude")
        : join(home, ".config", "Claude");
  return [
    { id: "claude-code", name: "Claude Code", kind: "claude-cli", marker: join(home, ".claude"), bin: "claude", skillDir: join(home, ".claude", "skills", "yap-machine") },
    { id: "codex", name: "Codex", kind: "toml", config: join(home, ".codex", "config.toml"), marker: join(home, ".codex"), bin: "codex", skillDir: join(home, ".codex", "skills", "yap-machine") },
    { id: "cursor", name: "Cursor", kind: "json", config: join(home, ".cursor", "mcp.json"), marker: join(home, ".cursor") },
    { id: "claude-desktop", name: "Claude Desktop", kind: "json", config: join(desktopDir, "claude_desktop_config.json"), marker: desktopDir },
    { id: "gemini", name: "Gemini CLI", kind: "json", config: join(home, ".gemini", "settings.json"), marker: join(home, ".gemini"), bin: "gemini" },
  ];
}

/**
 * Does `args` launch the current Yap Machine package: `yap-machine`, or a pinned `yap-machine@x.y.z`, then `mcp`?
 * Such an entry is a working registration however the user adjusted the rest of it (a full path to
 * npx and an env PATH, which a GUI app such as Claude Desktop often needs under nvm). Setup leaves
 * it alone, and doctor, which asks the mergers what would change, calls it registered.
 */
export function launchesYap(args: unknown): boolean {
  if (!Array.isArray(args)) return false;
  const at = args.findIndex((a) => a === SOURCE || (typeof a === "string" && a.startsWith(`${SOURCE}@`)));
  return at !== -1 && args[at + 1] === "mcp";
}

/** Preserve custom settings on the requested launcher; a local request replaces an npm launcher. */
function matchesLaunch(command: unknown, args: unknown, launch: McpLaunch): boolean {
  if (launchesYap(launch.args) && launchesYap(args)) {
    const at = launch.args.indexOf("--home");
    if (at === -1) return true;
    const have = args as string[];
    const haveAt = have.indexOf("--home");
    return haveAt !== -1 && have[haveAt + 1] === launch.args[at + 1];
  }
  return command === launch.command && JSON.stringify(args) === JSON.stringify(launch.args);
}

/** Yap Machine is already set up in a config in a form the mergers don't edit. Not a broken file: change it by hand. */
export class RegistrationFormError extends Error {}

/**
 * Add Yap Machine to a JSON config's "mcpServers" without touching anything else.
 * Throws if the existing file isn't a JSON object, so we never clobber it.
 * An entry that already launches the current package is left as the user has it.
 */
export function mergeJson(existing: string | null, launch: McpLaunch = DEFAULT_LAUNCH): { text: string; changed: boolean } {
  const doc: Record<string, unknown> = existing && existing.trim() ? JSON.parse(existing) : {};
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) throw new Error("config is not a JSON object");
  const servers = (doc.mcpServers ?? {}) as Record<string, unknown>;
  if (typeof servers !== "object" || Array.isArray(servers)) throw new Error('"mcpServers" is not an object');
  const want = { command: launch.command, args: launch.args };
  if (JSON.stringify(servers["yap-machine"]) === JSON.stringify(want)) return { text: existing ?? "", changed: false };
  const have = servers["yap-machine"];
  if (typeof have === "object" && have !== null && matchesLaunch((have as McpLaunch).command, (have as McpLaunch).args, launch)) return { text: existing ?? "", changed: false };
  doc.mcpServers = { ...servers, "yap-machine": { ...(typeof have === "object" && have !== null ? have : {}), ...want } };
  return { text: JSON.stringify(doc, null, 2) + "\n", changed: true };
}

const tomlBlock = (launch: McpLaunch) =>
  `[mcp_servers.yap-machine]\ncommand = ${JSON.stringify(launch.command)}\nargs = [${launch.args.map((a) => JSON.stringify(a)).join(", ")}]\n`;

const TOML_HEADER = /^\s*\[mcp_servers\.yap-machine\]\s*(#.*)?$/;

/**
 * Is yap-machine already defined under mcp_servers in a way mergeToml doesn't edit: an inline entry
 * (`yap-machine = { ... }` in [mcp_servers]), a quoted table name, or a dotted key at the top? Adding
 * [mcp_servers.yap-machine] beside one of those defines it twice, and TOML refuses that.
 */
function definedAnotherWay(lines: string[]): boolean {
  let section = "";
  for (const raw of lines) {
    const line = raw.replace(/#.*$/, "").trim();
    const header = /^\[\[?\s*([^\]]+?)\s*\]\]?$/.exec(line);
    if (header) {
      section = header[1].replace(/\s+/g, "");
      if (/^mcp_servers\.(["'])yap-machine\1(\.|$)/.test(section)) return true;
      continue;
    }
    if (/^mcp_servers\.(["']?)yap-machine\1\s*[.=]/.test(line)) return true;
    if (section === "mcp_servers" && /^(["']?)yap-machine\1\s*[.=]/.test(line)) return true;
  }
  return false;
}

/** The `args` list of a table body, or undefined when it can't be read (a comment inside it, single quotes). */
function tomlArgs(body: string): unknown {
  const m = /^[ \t]*args[ \t]*=[ \t]*(\[[\s\S]*?\])/m.exec(body);
  if (!m) return undefined;
  try {
    return JSON.parse(m[1].replace(/,(\s*\])$/, "$1"));
  } catch {
    return undefined;
  }
}

function tomlCommand(body: string): unknown {
  const m = /^[ \t]*command[ \t]*=[ \t]*("(?:[^"\\]|\\.)*")[ \t]*(?:#.*)?$/m.exec(body);
  try { return m ? JSON.parse(m[1]) : undefined; } catch { return undefined; }
}

/**
 * Add or replace the [mcp_servers["yap-machine"]] table in a Codex config.toml, leaving
 * everything else as written and keeping the file's line endings. This is line
 * surgery, not a TOML parser: it never makes a valid file invalid, and a file
 * that was already broken gets a backup (see setup.ts) and an appended table.
 * A table that already launches the current package is left as the user has it,
 * and an entry written in a form this can't edit throws RegistrationFormError.
 */
export function mergeToml(existing: string | null, launch: McpLaunch = DEFAULT_LAUNCH): { text: string; changed: boolean } {
  const text = existing ?? "";
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const block = tomlBlock(launch).trimEnd().split("\n");
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => TOML_HEADER.test(l));
  if (start === -1) {
    if (definedAnotherWay(lines)) throw new RegistrationFormError("yap-machine is already set up under mcp_servers in a form this can't edit (an inline, quoted or dotted entry); change it by hand");
    const body = text.replace(/(\r?\n)+$/, "");
    return { text: (body ? body + eol + eol : "") + block.join(eol) + eol, changed: true };
  }
  let end = lines.findIndex((l, i) => i > start && /^\s*\[/.test(l));
  if (end === -1) end = lines.length;
  const current = lines.slice(start + 1, end).map((l) => l.trim()).filter(Boolean);
  if (current.join("\n") === block.slice(1).join("\n")) return { text, changed: false };
  const body = lines.slice(start + 1, end).join("\n");
  if (matchesLaunch(tomlCommand(body), tomlArgs(body), launch)) return { text, changed: false };
  if (/^[ \t]*args[ \t]*=/m.test(body) && !Array.isArray(tomlArgs(body))) {
    throw new RegistrationFormError("yap-machine has an args list this setup can't safely edit; use a simple array of double-quoted strings, or update it by hand");
  }
  // Change only the launcher. Keep enabled flags, timeouts, env and comments in this table.
  const extras = body.replace(/^[ \t]*command[ \t]*=[^\n]*(?:\n|$)/m, "")
    .replace(/^[ \t]*args[ \t]*=[ \t]*\[[\s\S]*?\][^\n]*(?:\n|$)/m, "").trimEnd();
  const next = [...lines.slice(0, start), ...block, ...(extras ? extras.split("\n") : []), "", ...lines.slice(end)].join(eol);
  return { text: next.replace(/(\r?\n){3,}/g, eol + eol), changed: true };
}
