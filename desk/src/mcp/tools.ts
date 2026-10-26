import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiError, type DeskClient } from "./client.js";

export const VERSION = "0.1.0";

export interface ToolContext {
  client(): Promise<DeskClient>;
  openBrowser(url: string): void;
  home: string;
}

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] };
}

function fail(e: unknown) {
  const message = e instanceof ApiError ? `${e.message} (${e.body.error ?? e.status})` : (e as Error).message;
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

function safe<A>(fn: (args: A) => Promise<unknown>) {
  return async (args: A) => {
    try { return ok(await fn(args)); } catch (e) { return fail(e); }
  };
}

const tc = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

/** A batch as the agent should read it: plain words, timecodes, what to do next. */
export function describe(b: any, home: string, opts: { resumed?: boolean } = {}): string {
  const lines = [`Batch ${b.id} for project "${b.project}"${b.version ? ` (reviewing ${b.version})` : ""}.`, ""];
  if (b.notes.length) {
    lines.push("Notes on the video:");
    for (const n of b.notes) {
      lines.push(`- [${n.id}] ${n.version} at ${tc(n.at)}: ${n.text}`);
      if (opts.resumed) lines.push(`  Current state: ${n.status}.${n.reply ? ` Existing reply${n.fixedIn ? ` (in ${n.fixedIn})` : ""}: ${JSON.stringify(n.reply)}` : ""}`);
      // a note the person sent back: say what was tried, so the agent doesn't repeat it
      if (n.reopened && n.reply) lines.push(`  NOT FIXED (sent back${n.reopened > 1 ? ` ${n.reopened} times` : ""}). Your last reply${n.fixedIn ? ` (in ${n.fixedIn})` : ""}: "${n.reply}"`);
    }
    lines.push("");
  }
  if (b.messages.length) {
    lines.push("Messages:");
    for (const m of b.messages) lines.push(`- ${m.text || "(file only)"}${m.files.length ? ` [files: ${m.files.join(", ")}]` : ""}`);
    lines.push("");
  }
  if (b.look.length) {
    lines.push("Look changes (already written to style.json / people.json; re-render to apply):");
    for (const c of b.look) lines.push(`- ${c.label}`);
    lines.push("");
  }
  if (b.files.length) lines.push(`Files are under ${home}/<path>. Copy B-roll you use next to the footage, then re-run \`yap-machine prep\`.`, "");
  lines.push(
    `Project folder: ${home}/${b.project}. Make the next version (cuts/vN/edl.json → \`yap-machine cut vN -p ${home}/${b.project}\`), never overwrite a version the person has seen.`,
    `Then call yap_reply with project "${b.project}", batch "${b.id}", the new version, a short message, and a reply per note id.`,
  );
  return lines.join("\n");
}

export function createMcpServer(ctx: ToolContext): McpServer {
  const server = new McpServer({ name: "yap-machine", version: VERSION });

  server.registerTool(
    "yap_open",
    {
      title: "Open the Yap Machine desk",
      description: `Starts the desk if needed (a local web page for reviewing cuts, leaving notes and chatting with you, the agent) and opens it in the browser. Projects live in the workspace folder (${ctx.home}). Returns the desk's address and the projects in it.`,
      inputSchema: { browser: z.boolean().optional().describe("Open the browser. Default true.") },
    },
    safe(async ({ browser }) => {
      const c = await ctx.client();
      if (browser !== false) ctx.openBrowser(c.baseUrl + "/");
      const r = await c.get("/api/projects");
      return {
        url: c.baseUrl + "/",
        workspace: r.home,
        projects: r.projects.map((p: any) => ({ id: p.id, versions: p.versions.map((v: any) => v.version), shorts: p.shorts.map((s: any) => s.version) })),
      };
    }),
  );

  server.registerTool(
    "yap_new_project",
    {
      title: "Bring in a footage folder",
      description: "Makes a Yap project in the workspace from a folder of raw footage and prepares it (syncs any separate mic or screen recording, transcribes locally, numbers every phrase). Runs in the background; the desk shows progress. When it finishes, read <workspace>/<project>/takes.md and write cuts/v1/edl.json.",
      inputSchema: { footage: z.string().min(1).describe("Absolute path of the footage folder."), name: z.string().optional().describe("Short project name; defaults to the folder name.") },
    },
    safe(async ({ footage, name }) => {
      const c = await ctx.client();
      const job = await c.post("/api/projects", { footage, name });
      return { project: job.project, folder: `${ctx.home}/${job.project}`, state: job.state, next: "Wait for it to finish (yap_status), then cut it." };
    }),
  );

  server.registerTool(
    "yap_status",
    {
      title: "What's in the desk",
      description: "Projects, versions and checks, preparation jobs, and waiting or picked-up batches. Picked batches may still be active; use yap_resume_batch only after the previous agent session has stopped.",
      inputSchema: {},
    },
    safe(async () => {
      const c = await ctx.client();
      const [r, d] = await Promise.all([c.get("/api/projects"), c.get("/api/desk")]);
      return {
        url: c.baseUrl + "/",
        waitingBatches: d.batches.filter((b: any) => b.status === "waiting").map((b: any) => ({ id: b.id, project: b.project })),
        pickedBatches: d.batches.filter((b: any) => b.status === "picked").map((b: any) => ({ id: b.id, project: b.project, version: b.version, pickedAt: b.picked })),
        preparing: r.jobs.filter((j: any) => j.state === "running").map((j: any) => j.project),
        projects: r.projects.map((p: any) => ({
          id: p.id,
          versions: p.versions.map((v: any) => ({ version: v.version, duration: v.duration, errors: v.check?.errors.length ?? null })),
          shorts: p.shorts.map((s: any) => ({ version: s.version, duration: s.duration, languages: s.languages })),
        })),
      };
    }),
  );

  server.registerTool(
    "yap_next_batch",
    {
      title: "Pick up what the person sent",
      description: "Returns the next batch the person sent from the desk (notes pinned to timecodes, chat messages, files they attached, look changes) and marks it picked up. Pass wait_seconds to wait for one to arrive, so a conversation in the desk feels live. Returns nothing waiting when there's none.",
      inputSchema: {
        project: z.string().optional().describe("Only this project's batches."),
        wait_seconds: z.number().int().min(0).max(600).optional().describe("Wait up to this long for a batch. Default 0."),
      },
    },
    safe(async ({ project, wait_seconds }) => {
      const c = await ctx.client();
      const q = new URLSearchParams();
      if (project) q.set("project", project);
      if (wait_seconds) q.set("wait", String(wait_seconds));
      const r = await c.get(`/api/agent/next?${q}`);
      return r.batch ? describe(r.batch, ctx.home) : "Nothing waiting.";
    }),
  );

  server.registerTool(
    "yap_resume_batch",
    {
      title: "Resume an interrupted batch",
      description: "Reads a specific picked-up batch after a disconnect or stopped agent session. Use yap_status to find its ID. Only resume after the previous session has stopped; another agent may still be working on it. This does not requeue work or change note states. Inspect existing versions and replies before editing so completed work is not repeated, then reply using the same batch ID.",
      inputSchema: { batch: z.string().min(1).describe("The picked batch ID from yap_status, after the previous agent session has stopped.") },
    },
    safe(async ({ batch }) => {
      const c = await ctx.client();
      const r = await c.post("/api/agent/resume", { batch });
      return `Resuming existing work. Inspect the project's versions and these notes' current replies before making changes; do not repeat work already completed.\n\n${describe(r.batch, ctx.home, { resumed: true })}`;
    }),
  );

  server.registerTool(
    "yap_reply",
    {
      title: "Reply in the desk",
      description: "Posts your message in the desk's chat and answers notes: each note gets your reply and is marked done in the version you name. Use it after making a version (\"v5 is ready: …\"), to ask a question, or to say what you'll do.",
      inputSchema: {
        project: z.string(),
        message: z.string().min(1).describe("Plain words for the person. Say what changed and where (timecodes)."),
        batch: z.string().optional().describe("The batch you're answering; it's marked done unless done is false."),
        version: z.string().optional().describe("The version the fixes landed in, e.g. v5 or v2.s1."),
        notes: z.array(z.object({ id: z.string(), reply: z.string() })).optional().describe("A reply per note id from the batch."),
        done: z.boolean().optional().describe("Set false to reply without closing the batch (e.g. a question first)."),
      },
    },
    safe(async (args) => {
      const c = await ctx.client();
      await c.post("/api/agent/reply", args);
      return "Posted in the desk.";
    }),
  );

  return server;
}
