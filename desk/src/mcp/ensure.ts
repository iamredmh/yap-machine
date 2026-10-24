import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalRoot, isDeskFor, readLock } from "../server/lock.js";
import { DeskClient } from "./client.js";
import { DESK_DIR } from "../core/store.js";

/** The workspace: YAP_HOME, or ~/Yap. Every project the desk shows is a folder in here. */
export function defaultHome(): string {
  const env = process.env.YAP_HOME;
  if (env) return resolve(env.replace(/^~(?=$|\/)/, homedir()));
  return join(homedir(), "Yap");
}

/** URL of a live desk for exactly this workspace, or null. */
export async function findServer(homeDir: string): Promise<string | null> {
  const root = await canonicalRoot(homeDir);
  const lock = await readLock(root);
  if (!lock) return null;
  return (await isDeskFor(lock.port, root)) ? `http://127.0.0.1:${lock.port}` : null;
}

/** Background desks started for an agent stop after this long with nothing connected. */
export const BACKGROUND_IDLE_MINUTES = 240;

export function serverLogPath(root: string): string {
  return join(root, DESK_DIR, "server.log");
}

function defaultSpawn(root: string): void {
  const cli = fileURLToPath(new URL("../cli/index.js", import.meta.url));
  let log: number | "ignore" = "ignore";
  try {
    mkdirSync(join(root, DESK_DIR), { recursive: true });
    log = openSync(serverLogPath(root), "a");
  } catch { /* no log; the start may still work */ }
  try {
    const args = [cli, "serve", root, "--idle-minutes", String(BACKGROUND_IDLE_MINUTES)];
    if (process.env.YAP_PORT) args.push("--port", process.env.YAP_PORT);
    const child = spawn(process.execPath, args, { detached: true, stdio: ["ignore", log, log], windowsHide: true });
    child.on("error", () => undefined);
    child.unref();
  } finally {
    if (typeof log === "number") closeSync(log);
  }
}

const pending = new Map<string, Promise<DeskClient>>();

/** Find the workspace's desk, starting one in the background if needed. */
export async function ensureServer(homeDir: string, spawnServer = defaultSpawn): Promise<DeskClient> {
  mkdirSync(homeDir, { recursive: true });
  const root = await canonicalRoot(homeDir);
  const inFlight = pending.get(root);
  if (inFlight) return inFlight;
  const run = (async () => {
    const found = await findServer(root);
    if (found) return new DeskClient(found);
    spawnServer(root);
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 150));
      const url = await findServer(root);
      if (url) return new DeskClient(url);
    }
    throw new Error(`The desk didn't start for ${root}. Its output is in ${serverLogPath(root)}.`);
  })().finally(() => pending.delete(root));
  pending.set(root, run);
  return run;
}
