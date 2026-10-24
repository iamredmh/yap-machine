import { request } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NetworkInterfaceInfo } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isLoopbackHost, keyMatches, lanAddresses, lanDenied, lanLinks, newKey, readCookie } from "./lan.js";
import { startServer, type Desk } from "./start.js";

const nic = (address: string, o: Partial<NetworkInterfaceInfo> = {}) => ({ address, family: "IPv4", internal: false, netmask: "", mac: "", cidr: null, ...o }) as NetworkInterfaceInfo;

describe("addresses and links", () => {
  const ifaces = {
    lo0: [nic("127.0.0.1", { internal: true })],
    utun3: [nic("100.64.1.2")],
    en0: [nic("192.168.1.20"), { ...nic("fe80::1"), family: "IPv6" } as NetworkInterfaceInfo],
    bridge0: [nic("169.254.8.8")],
    en5: [nic("10.0.0.7")],
  };
  it("lists usable IPv4 addresses, home ranges first, and skips loopback, link-local and IPv6", () => {
    expect(lanAddresses(ifaces).map((a) => a.address)).toEqual(["192.168.1.20", "10.0.0.7", "100.64.1.2"]);
  });
  it("puts the code in every link and adds the computer's .local name once", () => {
    const links = lanLinks(4780, "KEY", lanAddresses(ifaces), "Yap-Test-Mac.local");
    expect(links[0].url).toBe("http://192.168.1.20:4780/?k=KEY");
    expect(links.at(-1)!.url).toBe("http://Yap-Test-Mac.local:4780/?k=KEY");
    expect(links.every((l) => l.url.includes("?k=KEY"))).toBe(true);
  });
  it("gives no links when there is no network, and skips an odd host name", () => {
    expect(lanLinks(4780, "K", [], "box")).toEqual([]);
    expect(lanLinks(4780, "K", lanAddresses(ifaces), "Red's Mac").map((l) => l.address)).not.toContain("Red's Mac.local");
  });
  it("makes a fresh long code each time", () => {
    const a = newKey(), b = newKey();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(24);
  });
});

describe("the rules", () => {
  it("accepts only this computer's own names on the loopback door", () => {
    for (const h of ["localhost:4690", "127.0.0.1:4690", "[::1]:4690", "localhost", "yap.localhost:1"]) expect(isLoopbackHost(h)).toBe(true);
    for (const h of ["evil.example:4690", "192.168.1.20:4690", "127.0.0.1.evil.example", "", undefined]) expect(isLoopbackHost(h)).toBe(false);
  });
  it("keeps the dangerous routes off the phone and leaves review open", () => {
    for (const [m, p] of [["POST", "/api/shutdown"], ["GET", "/api/doctor"], ["POST", "/api/lan"], ["GET", "/api/agent/next"], ["POST", "/api/agent/reply"], ["POST", "/api/projects"], ["POST", "/api/footage"], ["POST", "/api/projects/p/prepare"]]) expect(lanDenied(m, p)).toBe(true);
    for (const [m, p] of [["GET", "/api/lan"], ["GET", "/api/projects"], ["GET", "/api/projects/p/versions/v1"], ["POST", "/api/notes"], ["POST", "/api/chat"], ["POST", "/api/projects/p/send"], ["GET", "/media/p/renders/v1.mp4"], ["GET", "/api/events"]]) expect(lanDenied(m, p)).toBe(false);
  });
  it("reads a cookie and compares codes without length tricks", () => {
    expect(readCookie("a=1; yap_k=abc%2D; b=2", "yap_k")).toBe("abc-");
    expect(readCookie(undefined, "yap_k")).toBeUndefined();
    expect(keyMatches("abc", "abc")).toBe(true);
    expect(keyMatches("abd", "abc")).toBe(false);
    expect(keyMatches("ab", "abc")).toBe(false);
    expect(keyMatches(null, "abc")).toBe(false);
    expect(keyMatches("abc", undefined)).toBe(false);
  });
});

describe("a running desk", () => {
  let dir: string, desk: Desk;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "yap-lan-"));
    await mkdir(join(dir, "web"), { recursive: true });
    await writeFile(join(dir, "web", "index.html"), "<title>desk</title>");
    desk = await startServer(join(dir, "ws"), { port: 0, webDir: join(dir, "web") });
  });
  afterEach(async () => { await desk.close(); await rm(dir, { recursive: true, force: true }); });

  const hasNetwork = lanAddresses().length > 0;
  /** A request with its own Host header (fetch won't let us set one). */
  const withHost = (port: number, host: string) => new Promise<number>((ok, fail) => {
    const r = request({ host: "127.0.0.1", port, path: "/api/health", headers: { host } }, (res) => { res.resume(); ok(res.statusCode ?? 0); });
    r.on("error", fail); r.end();
  });
  const get = (url: string, headers: Record<string, string> = {}, method = "GET") => fetch(url, { method, headers, redirect: "manual" });

  it("is off until asked, and the loopback door refuses a foreign Host", async () => {
    expect(desk.lan.info()).toEqual({ on: false, links: [] });
    expect((await get(`${desk.url}/api/health`)).status).toBe(200);
    expect(await withHost(desk.port, "evil.example")).toBe(421);
    expect(await withHost(desk.port, "localhost:" + desk.port)).toBe(200);
    const lan = await (await get(`${desk.url}/api/lan`)).json();
    expect(lan.on).toBe(false);
  });

  it.skipIf(!hasNetwork)("opens a second door that needs the code, sets a cookie, and blocks the dangerous routes", async () => {
    const on = await (await fetch(`${desk.url}/api/lan`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ on: true }) })).json();
    expect(on.on).toBe(true);
    const link = new URL(on.links[0].url);
    const base = `http://127.0.0.1:${link.port}`;
    const key = link.searchParams.get("k")!;
    expect(Number(link.port)).not.toBe(desk.port);

    expect((await get(`${base}/api/projects`)).status).toBe(401);                       // no code
    expect((await get(`${base}/api/projects?k=wrong`)).status).toBe(401);                // wrong code
    const first = await get(`${base}/?k=${key}`);
    expect(first.status).toBe(302);                                                     // right code: cookie, then the clean address
    expect(first.headers.get("location")).toBe("/");
    const cookie = first.headers.get("set-cookie")!;
    expect(cookie).toMatch(/yap_k=.*HttpOnly.*SameSite=Strict/);
    const jar = { cookie: cookie.split(";")[0] };
    expect((await get(`${base}/api/projects`, jar)).status).toBe(200);                   // the cookie is enough
    expect((await get(`${base}/`, jar)).status).toBe(200);
    const ask = await (await get(`${base}/api/lan`, jar)).json();
    expect(ask).toEqual({ on: false, links: [], unavailable: true });   // a phone is told it can't, without an error
    for (const [m, p] of [["POST", "/api/shutdown"], ["GET", "/api/doctor"], ["POST", "/api/lan"], ["GET", "/api/agent/next"], ["POST", "/api/projects"]] as const) {
      expect((await get(`${base}${p}`, jar, m)).status, `${m} ${p}`).toBe(403);
    }
    // a query keeps its other parts when the code is taken out
    const q = await get(`${base}/api/projects?x=1&k=${key}`);
    expect(q.headers.get("location")).toBe("/api/projects?x=1");

    // off: the door closes and the code is dead; on again: a new code
    await fetch(`${desk.url}/api/lan`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ on: false }) });
    await expect(get(`${base}/api/projects`, jar)).rejects.toThrow();
    expect(desk.lan.info().on).toBe(false);
    const again = await desk.lan.enable();
    const key2 = new URL(again.links[0].url).searchParams.get("k")!;
    expect(key2).not.toBe(key);
    expect((await get(`http://127.0.0.1:${again.port}/api/projects`, jar)).status).toBe(401);
  });

  it("the phone door can't turn sharing on or off, and the desk's own door still can", async () => {
    if (!hasNetwork) return;
    const info = await desk.lan.enable();
    const link = new URL(info.links[0].url);
    const jar = { cookie: `yap_k=${link.searchParams.get("k")}` };
    const res = await fetch(`http://127.0.0.1:${link.port}/api/lan`, { method: "POST", headers: { ...jar, "content-type": "application/json" }, body: JSON.stringify({ on: false }) });
    expect(res.status).toBe(403);
    expect(desk.lan.info().on).toBe(true);
  });

  it("stopping the desk stops sharing", async () => {
    if (!hasNetwork) return;
    const info = await desk.lan.enable();
    const port = info.port!;
    await desk.close();
    await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();
    desk = await startServer(join(dir, "ws"), { port: 0, webDir: join(dir, "web") });
  });
});
