import { spawn } from "node:child_process";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./tools.js";
import { defaultHome, ensureServer } from "./ensure.js";

export function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true }).on("error", () => undefined).unref();
}

/** Run the MCP server over stdio for the agent. */
export async function runStdio(home = defaultHome()): Promise<void> {
  const server = createMcpServer({ client: () => ensureServer(home), openBrowser, home });
  await server.connect(new StdioServerTransport());
}
