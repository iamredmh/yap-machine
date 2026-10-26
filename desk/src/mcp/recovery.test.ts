import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createMcpServer } from "./tools.js";
import { ApiError, type DeskClient } from "./client.js";
import { createApp } from "../server/app.js";
import { addNote, sendBatch } from "../core/batches.js";
import { Store } from "../core/store.js";
import { lanDenied } from "../server/lan.js";

// These protocol tests exercise the API without a live filesystem event watcher.
vi.mock("node:fs", async (original) => ({
  ...await original<typeof import("node:fs")>(),
  watch: () => { throw new Error("Filesystem watching is disabled in protocol tests"); },
}));

let home: string, store: Store, client: Client;
let server: ReturnType<typeof createMcpServer>;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "yap-mcp-recovery-"));
  store = new Store(home); await store.init();
  const app = createApp(store);
  const request = async (path: string, body?: unknown) => {
    const response = await app.request("http://localhost" + path, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new ApiError(response.status, result);
    return result;
  };
  const desk = { baseUrl: "http://localhost", get: request, post: request } as DeskClient;
  server = createMcpServer({ home, client: async () => desk, openBrowser: () => {} });
  client = new Client({ name: "recovery-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});
afterEach(async () => { await client.close(); await server.close(); await rm(home, { recursive: true, force: true }); });

const text = (result: any) => result.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");

it("exposes picked work in status and resumes it explicitly through MCP and HTTP", async () => {
  const note = await addNote(store, { project: "p1", version: "v1", at: 12, text: "Fix the name" });
  const batch = await sendBatch(store, "p1", "v1");
  await client.callTool({ name: "yap_next_batch", arguments: {} });
  const status = JSON.parse(text(await client.callTool({ name: "yap_status", arguments: {} })));
  expect(status.waitingBatches).toEqual([]);
  expect(status.pickedBatches).toMatchObject([{ id: batch.id, project: "p1", version: "v1" }]);
  expect(status.pickedBatches[0].pickedAt).toBeTruthy();
  expect(text(await client.callTool({ name: "yap_next_batch", arguments: {} }))).toBe("Nothing waiting.");
  const resumed = await client.callTool({ name: "yap_resume_batch", arguments: { batch: batch.id } });
  expect(resumed.isError).not.toBe(true);
  expect(text(resumed)).toContain(`Batch ${batch.id}`);
  expect(text(resumed)).toContain(`[${note.id}] v1 at 0:12: Fix the name`);
  expect(text(resumed)).toContain("Current state: sent.");
  expect(text(await client.callTool({ name: "yap_resume_batch", arguments: { batch: batch.id } }))).toBe(text(resumed));
  await client.callTool({ name: "yap_reply", arguments: { project: "p1", batch: batch.id, message: "Fixed in v2", version: "v2", notes: [{ id: note.id, reply: "Corrected the name" }] } });
  const finished = await client.callTool({ name: "yap_resume_batch", arguments: { batch: batch.id } });
  expect(finished.isError).toBe(true);
  expect(text(finished)).toContain("already completed");
  expect(JSON.parse(text(await client.callTool({ name: "yap_status", arguments: {} }))).pickedBatches).toEqual([]);
});

it("does not claim waiting work on resume and keeps recovery off the phone connection", async () => {
  await addNote(store, { project: "p1", version: "v1", at: 0, text: "Try a stronger opening" });
  const batch = await sendBatch(store, "p1");
  expect((await client.callTool({ name: "yap_resume_batch", arguments: { batch: batch.id } })).isError).toBe(true);
  expect((await client.callTool({ name: "yap_resume_batch", arguments: { batch: "missing" } })).isError).toBe(true);
  expect((await store.read("batches")).batches[0].status).toBe("waiting");
  expect(lanDenied("POST", "/api/agent/resume")).toBe(true);
});
