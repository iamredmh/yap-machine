import { createServer, type Server } from "node:http";
import { mkdir, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getRequestListener } from "@hono/node-server";
import { Store } from "../core/store.js";
import { InvalidError } from "../core/errors.js";
import { createApp } from "./app.js";
import { removeLock, writeLock } from "./lock.js";
import { lanAddresses, lanLinks, newKey, type LanController, type LanInfo } from "./lan.js";

export const DEFAULT_PORT = 4680;

export interface Running {
  url: string;
  port: number;
  store: Store;
  close(): Promise<void>;
  closed: Promise<void>;
}

export interface StartOptions {
  port?: number;
  host?: string;
  webDir?: string;
  /** Close after this long with no requests and no open connections. Off by default. */
  idleMs?: number;
}

export interface Desk extends Running {
  /** Phone access: a second listener on the local network, locked behind a random code. */
  lan: LanController;
}

/** The built web app shipped next to this package's dist/. */
export function defaultWebDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "web-dist");
}

function listen(server: Server, port: number, host: string): Promise<number> {
  return new Promise((ok, fail) => {
    const onError = (e: NodeJS.ErrnoException) => { server.off("listening", onListening); fail(e); };
    const onListening = () => {
      server.off("error", onError);
      const addr = server.address();
      ok(typeof addr === "object" && addr ? addr.port : port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

/**
 * Start the desk for a workspace folder (one folder of Yap projects). Tries
 * `port` and the next ten; one desk per workspace, claimed with the Rushes lock.
 */
export async function startServer(homeDir: string, opts: StartOptions = {}): Promise<Desk> {
  await mkdir(resolve(homeDir), { recursive: true });
  const root = await realpath(resolve(homeDir));
  const store = new Store(root);
  await store.init();
  let close: () => Promise<void> = async () => undefined;
  // phone access: a second server, same app, that knows it came in from the network
  let lanServer: Server | null = null;
  let lanKey: string | undefined;
  let lanPort = 0;
  let mainPort = 0;
  const lan: LanController = {
    key: () => lanKey,
    info: (): LanInfo => (lanServer && lanKey ? { on: true, port: lanPort, links: lanLinks(lanPort, lanKey) } : { on: false, links: [] }),
    async enable() {
      if (lanServer) return lan.info();
      if (!lanAddresses().length) throw new InvalidError("No network connection was found. Connect to Wi-Fi and try again.");
      const s = createServer((req, res) => { lastRequest = Date.now(); lanListener(req, res); });
      const preferred = mainPort > 0 ? mainPort + 100 : 0;
      let got = -1;
      for (let p = preferred; p <= (preferred === 0 ? 0 : preferred + 10) && got < 0; p++) {
        try { got = await listen(s, p, "0.0.0.0"); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EADDRINUSE") throw e; }
      }
      if (got < 0) got = await listen(s, 0, "0.0.0.0");
      lanServer = s; lanPort = got; lanKey = newKey();
      return lan.info();
    },
    async disable() {
      const s = lanServer;
      lanServer = null; lanKey = undefined;
      if (!s) return;
      s.closeAllConnections?.();
      await new Promise<void>((ok) => s.close(() => ok()));
    },
  };
  const app = createApp(store, { webDir: opts.webDir ?? defaultWebDir(), onShutdown: () => void close(), lan });
  const listener = getRequestListener((req, env) => app.fetch(req, env));
  const lanListener = getRequestListener((req, env) => app.fetch(req, { ...env, lan: true }));
  let lastRequest = Date.now();
  const server = createServer((req, res) => { lastRequest = Date.now(); listener(req, res); });
  const host = opts.host ?? "127.0.0.1";
  const first = opts.port ?? DEFAULT_PORT;
  let port = -1;
  let lastError: unknown;
  for (let p = first; p <= (first === 0 ? 0 : first + 10); p++) {
    try { port = await listen(server, p, host); break; } catch (e) {
      lastError = e;
      if ((e as NodeJS.ErrnoException).code !== "EADDRINUSE") throw e;
    }
  }
  mainPort = port;
  if (port < 0) throw new Error(`No free port from ${first} to ${first + 10}: ${(lastError as Error)?.message}`);
  let token: string | undefined;
  try {
    token = (await writeLock(root, port)).token;
  } catch (e) {
    server.closeAllConnections?.();
    await new Promise<void>((ok) => server.close(() => ok()));
    throw e;
  }
  const url = `http://${host}:${port}`;
  let idleTimer: NodeJS.Timeout | undefined;
  let done: () => void = () => undefined;
  const closed = new Promise<void>((ok) => { done = ok; });
  let closing: Promise<void> | null = null;
  close = () => {
    closing ??= (async () => {
      clearTimeout(idleTimer);
      await lan.disable();
      server.closeAllConnections?.();
      await new Promise<void>((ok) => server.close(() => ok()));
      await removeLock(root, token);
      done();
    })();
    return closing;
  };
  if (opts.idleMs && opts.idleMs > 0) {
    const idleMs = opts.idleMs;
    const tick = () => {
      server.getConnections((_err, open) => {
        if (!lanServer && open === 0 && Date.now() - lastRequest >= idleMs) void close();
        else idleTimer = setTimeout(tick, Math.max(50, idleMs / 4));
      });
    };
    idleTimer = setTimeout(tick, idleMs);
    idleTimer.unref?.();
  }
  return { url, port, store, close, closed, lan };
}
