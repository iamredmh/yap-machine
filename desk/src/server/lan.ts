import { randomBytes, timingSafeEqual } from "node:crypto";
import { hostname, networkInterfaces, type NetworkInterfaceInfo } from "node:os";

/**
 * Review from a phone. The desk always listens on 127.0.0.1. Turning phone access on opens a second
 * listener on the local network, and every request to it needs a random code that is in the link (and
 * the QR code). The code becomes a cookie on first use. Turning it off closes that listener and the code
 * stops working; a new code is made next time. Nothing here is saved to disk.
 */

export interface LanLink { url: string; label: string; address: string }
export interface LanInfo {
  on: boolean;
  port?: number;
  /** The first link is the one to put in the QR code; the rest are other ways to reach this computer. */
  links: LanLink[];
}

export interface LanController {
  info(): LanInfo;
  enable(): Promise<LanInfo>;
  disable(): Promise<void>;
  /** The current code, or undefined while phone access is off. */
  key(): string | undefined;
}

export const LAN_COOKIE = "yap_k";

export const newKey = () => randomBytes(18).toString("base64url");

/** This computer's usable IPv4 addresses on the local network, home-network ranges first. */
export function lanAddresses(ifaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()): { address: string; name: string }[] {
  const rank = (a: string) => (a.startsWith("192.168.") ? 0 : a.startsWith("10.") ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(a) ? 2 : 3);
  const out: { address: string; name: string; rank: number }[] = [];
  for (const [name, list] of Object.entries(ifaces)) {
    for (const i of list ?? []) {
      if (i.family !== "IPv4" || i.internal || i.address.startsWith("169.254.")) continue;
      out.push({ address: i.address, name, rank: rank(i.address) });
    }
  }
  return out.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name)).map(({ address, name }) => ({ address, name }));
}

/** The links to open on a phone: one per address, plus the computer's `.local` name, which survives a changing address. */
export function lanLinks(port: number, key: string, addrs = lanAddresses(), host = hostname()): LanLink[] {
  const q = `/?k=${key}`;
  const links = addrs.map((a, i) => ({ url: `http://${a.address}:${port}${q}`, label: i === 0 ? "This computer's address" : `Address on ${a.name}`, address: a.address }));
  const bare = host.replace(/\.local$/i, "");
  if (links.length && /^[A-Za-z0-9-]+$/.test(bare)) links.push({ url: `http://${bare}.local:${port}${q}`, label: "This computer's name", address: `${bare}.local` });
  return links;
}

/** Requests on the loopback listener must name this computer, so a web page can't reach the desk by pointing its own name at 127.0.0.1. */
export function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false;
  const name = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.replace(/:\d+$/, "");
  return name === "localhost" || name.endsWith(".localhost") || name === "127.0.0.1" || name === "[::1]";
}

/** A phone can review: look, leave notes, chat, send. It can't start the engine on a folder, stop the desk, act as the agent, or change sharing (it may ask, and is told it can't). */
export function lanDenied(method: string, path: string): boolean {
  if (method !== "GET" && /\/(visual-render|visual-assets|prepare)$/.test(path)) return true;
  if (path === "/api/shutdown" || path === "/api/doctor") return true;
  if (path.startsWith("/api/agent/") || (path === "/api/lan" && method !== "GET")) return true;
  if (method === "POST" && (path === "/api/projects" || path === "/api/footage")) return true;
  return false;
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

export function keyMatches(supplied: string | null | undefined, key: string | undefined): boolean {
  if (!supplied || !key) return false;
  const a = Buffer.from(supplied), b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const NEEDS_KEY_PAGE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Yap Machine</title>
<body style="font:16px/1.5 system-ui,sans-serif;max-width:30em;margin:15vh auto;padding:0 20px;color:#0b0b0d"><h1 style="font-size:22px">This link needs its code</h1>
<p>Open the desk on your computer, press <b>Phone</b>, and scan the QR code again. If you turned sharing off, turn it on for a new link.</p></body>`;
