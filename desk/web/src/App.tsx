import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { api, media, subscribe, tc } from "./api.js";
import { Timeline } from "./Timeline.js";
import { Qr } from "./Qr.js";
import { NOTE_FILTERS, doctorStatus, filterNotes, isJoinWarning, noteCounts, noteState, versionStatus, type NoteFilter, type Status } from "./status.js";
import { NO_RANGE, PAUSED, SPEED_KEY, clock, hasRange, isTyping, keyAction, loopJump, markersFor, playLabel, press, rangeLabel, readSpeed, setEdge, speedLabel, stepFrames, stepMarker, stepSpeed, type KeyAction, type LoopRange, type Play } from "./timeline-math.js";
import { ControlBar } from "./ControlBar.js";
import { ComparePanel, DiffStrip } from "./Compare.js";
import { KeySelect } from "./KeySelect.js";
import { diffCuts, mapTime, viewInA } from "./cut-diff.js";
import { clampView, fullView, keyZoom, type View as Win } from "./timeline-zoom.js";
import { hit } from "./focus.js";
import { VisualStudio } from "./VisualStudio.js";
import { captionEditState } from "./caption-edit-state.js";
import { StudioIcon } from "./StudioIcon.js";
import { ReviewTabs } from "./ReviewTabs.js";
import "./workflow.css";

type View = "start" | "inbox" | "review" | "shorts" | "look";
const VIEWS: View[] = ["start", "inbox", "review", "shorts", "look"];

const store = {
  get: (k: string) => { try { return localStorage.getItem("yap:" + k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem("yap:" + k, v); } catch { /* private window */ } },
};

/** The one place a version's state is drawn. A pill you can click opens the checks; the rest are just words. */
function StatusPill({ status, onClick, expanded }: { status: Status; onClick?: () => void; expanded?: boolean }) {
  const cls = "pill " + (status.tone === "plain" ? "face" : status.tone);
  if (onClick && (status.kind === "fix" || status.kind === "look")) {
    return <button class={cls + " pill-btn"} aria-expanded={expanded} title="Show what to look at" onClick={onClick}><span class="dot" aria-hidden="true" />{status.label}</button>;
  }
  return <span class={cls}><span class="dot" aria-hidden="true" />{status.label}</span>;
}

export function App() {
  const [projects, setProjects] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [home, setHome] = useState("");
  const [desk, setDesk] = useState<any>({ notes: [], messages: [], batches: [], look: [] });
  const [pid, setPid] = useState<string | null>(store.get("project"));
  const [view, setView] = useState<View>(() => {
    const h = location.hash.slice(1) as View;
    return VIEWS.includes(h) ? h : ((store.get("view") as View) || "review");
  });
  const [chatOpen, setChatOpen] = useState(store.get("chat") !== "off");
  const [stamp, setStamp] = useState(0);
  const [selectedCuts, setSelectedCuts] = useState<Record<string, string>>({});
  // Remember the viewing preference; feedback panels are available on the first visit.
  const [focus, setFocus] = useState(store.get("focus") === "on");
  useEffect(() => { store.set("focus", focus ? "on" : "off"); }, [focus]);
  const [loaded, setLoaded] = useState(false);
  // phone access: only the computer itself can ask (a phone gets a 403 and never sees the button)
  const [lan, setLan] = useState<{ available: boolean; on: boolean }>({ available: false, on: false });
  const [phoneOpen, setPhoneOpen] = useState(false);
  const loadLan = () => api.get("/api/lan").then((r) => setLan({ available: !r.unavailable, on: !!r.on })).catch(() => setLan({ available: false, on: false }));
  useEffect(() => { loadLan(); }, []);

  const loadProjects = () => api.get("/api/projects").then((r) => { setProjects(r.projects); setJobs(r.jobs); setHome(r.home); setLoaded(true); }).catch(() => setLoaded(true));
  const refreshDesk = () => api.get("/api/desk").then(setDesk);
  const loadDesk = () => refreshDesk().catch(() => undefined);
  useEffect(() => {
    loadProjects();
    loadDesk();
    return subscribe((type) => {
      if (type === "desk") loadDesk();
      else { loadProjects(); setStamp((s) => s + 1); }
    });
  }, []);
  useEffect(() => { store.set("view", view); history.replaceState(null, "", "#" + view); }, [view]);
  useEffect(() => {
    const on = () => { const h = location.hash.slice(1) as View; if (VIEWS.includes(h)) setView(h); };
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  useEffect(() => { store.set("chat", chatOpen ? "on" : "off"); }, [chatOpen]);

  const project = projects.find((p) => p.id === pid) ?? projects[0] ?? null;
  useEffect(() => { if (project && project.id !== pid) setPid(project.id); if (loaded && !project && view !== "start") setView("inbox"); }, [project?.id, loaded]);
  useEffect(() => { if (pid) store.set("project", pid); }, [pid]);

  const waitingCount = project ? desk.notes.filter((n: any) => n.project === project.id && n.status === "open").length + desk.look.filter((c: any) => c.project === project.id).length : 0;
  const agentBusy = project && desk.batches.some((b: any) => b.project === project.id && b.status === "picked");
  const agentWaiting = project && desk.batches.some((b: any) => b.project === project.id && b.status === "waiting");

  const latest = project?.versions.at(-1);
  const latestStatus = versionStatus(latest);
  const tab = (v: View, label: string, n?: string | number, status?: Status) => (
    <button class="tab" aria-current={view === v ? "page" : undefined} onClick={() => setView(v)}
      aria-label={status && status.count ? `${label}${n ? ` ${n}` : ""}, ${status.label}` : label}>
      {/^[123] · /.test(label) ? <><span class="workflow-step" aria-hidden="true">{label[0]}</span><span>{label.slice(4)}</span></> : label}{n !== undefined && n !== "" ? <span class="n">{n}</span> : null}
      {status && status.count ? <span class={"n " + (status.kind === "fix" ? "bad" : "warn")} title={status.label}>{status.count}</span> : null}
    </button>
  );
  const wide = (view === "review" || view === "look") && !!project;

  return (
    <div class={"app" + (chatOpen && !focus ? "" : " nochat")}>
      <header class="top">
        <div class="mark"><span class={"recdot" + (agentBusy ? " live" : "")} aria-hidden="true" />Yap Machine</div>
        {projects.length > 0 && (
          <select class="select" aria-label="Project" value={project?.id} onChange={(e) => setPid((e.target as HTMLSelectElement).value)}>
            {projects.map((p) => <option value={p.id}>{p.name}</option>)}
          </select>
        )}
        <nav class="tabs" aria-label="Sections">
          {tab("inbox", "1 · Footage")}
          {tab("review", "2 · Review", "", latestStatus)}
          {tab("look", "3 · Style & export")}
          {tab("shorts", "Shorts", project?.shorts.length || "")}
        </nav>
        <span class="spacer" />
        {agentBusy ? <span class="pill rec"><span class="dot" />Your agent is working</span> : agentWaiting ? <span class="pill warn"><span class="dot" />Waiting for your agent</span> : null}
        <button class="btn small ghost setup-link" onClick={() => setView("start")}>Setup</button>
        {lan.available && (
          <button class="btn small" aria-haspopup="dialog" aria-label={lan.on ? "Phone, sharing is on" : "Phone"} onClick={() => setPhoneOpen(true)}>
            Phone{lan.on && <span class="live-tag">on</span>}
          </button>
        )}
        <button class="btn small" aria-pressed={chatOpen && !focus} onClick={() => { setChatOpen(focus || !chatOpen); setFocus(false); }}>Agent chat</button>
      </header>

      <main class={"main" + (wide ? " work-main" : "")}>
        {!loaded ? <section class="view"><p class="faint">Loading…</p></section>
          : view === "start" ? <Start />
          : view === "inbox" ? <Inbox projects={projects} jobs={jobs} home={home} onOpen={(id) => { setPid(id); setView("review"); }} />
          : !project ? <section class="view"><Empty go={() => setView("inbox")} /></section>
          : view === "review" ? <Review key={project.id} project={project} desk={desk} stamp={stamp} waitingCount={waitingCount} focus={focus} setFocus={(f) => { setFocus(f); setChatOpen(false); }} initialVersion={selectedCuts[project.id]} onVersion={(v) => setSelectedCuts(c => ({ ...c, [project.id]: v }))} onStyle={() => setView("look")} onChat={() => { setFocus(false); setChatOpen(true); }} />
          : view === "shorts" ? <Shorts project={project} desk={desk} waitingCount={waitingCount} />
          : <Look key={project.id} project={project} desk={desk} refreshDesk={refreshDesk} initialVersion={selectedCuts[project.id]} onVersion={(v) => setSelectedCuts(c => ({ ...c, [project.id]: v }))} />}
      </main>

      {phoneOpen && <PhoneAccess onClose={() => { setPhoneOpen(false); loadLan(); }} />}
      <Chat project={project} desk={desk} busy={!!agentBusy} waitingAgent={!!agentWaiting} />
    </div>
  );
}

function PhoneAccess({ onClose }: { onClose: () => void }) {
  const [info, setInfo] = useState<{ on: boolean; links: { url: string; label: string; address: string }[] } | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    close.current?.focus();
    api.get("/api/lan").then(setInfo).catch((e) => setErr(e.message));
    const on = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    addEventListener("keydown", on);
    return () => { removeEventListener("keydown", on); back?.focus?.({ preventScroll: true }); };
  }, []);
  const set = async (on: boolean) => {
    setErr(""); setBusy(true);
    try { setInfo(await api.post("/api/lan", { on })); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  const [first, ...rest] = info?.links ?? [];
  return (
    <div class="lightbox" onClick={onClose}>
      <div class="lightbox-card sheet-keys phone" role="dialog" aria-modal="true" aria-labelledby="phone-title" onClick={(e) => e.stopPropagation()}>
        <div class="row between"><h2 id="phone-title">Open on your phone</h2><button ref={close} class="btn small" onClick={onClose}>Close</button></div>
        {!info ? <p class="faint">{err || "Checking…"}</p> : !info.on ? (
          <>
            <p>Your phone and this computer need to be on the same Wi-Fi. Turning this on shows a QR code; scan it with the phone's camera.</p>
            <p class="muted small">While it is on, any device on that network that has the link can see your cuts and leave notes. It can't start the engine or stop the desk. It turns off when you press the button again or stop the desk.</p>
            <div class="row"><button class="btn primary" disabled={busy} onClick={() => set(true)}>Turn on phone access</button></div>
          </>
        ) : (
          <>
            <div class="phone-grid">
              {first && <Qr text={first.url} label="QR code for the link to this desk. Scan it with your phone's camera." />}
              <div class="stack" style="gap:10px;min-width:0">
                <p><b>Scan with your phone's camera</b>, or type the link:</p>
                <div class="cmd"><span>{first?.url.replace(/\?k=.*/, "")}</span><Copy text={first?.url ?? ""} /></div>
                <p class="muted small">Copy gives the full link, with its code. The code is new each time you turn this on.</p>
              </div>
            </div>
            {rest.length > 0 && (
              <details>
                <summary class="small">Other addresses, if the first one doesn't work</summary>
                <div class="stack" style="gap:6px;margin-top:8px">{rest.map((l) => <div class="row between"><span class="small"><span class="mono">{l.address}</span> <span class="faint">· {l.label.toLowerCase()}</span></span><Copy text={l.url} /></div>)}</div>
              </details>
            )}
            <p class="fine">Anyone on this network with the link can see your cuts and leave notes until you stop. The link is plain http, so use home or trusted Wi-Fi. Videos are served from this computer; nothing is uploaded. If your Mac asks whether to allow incoming connections for node, choose Allow.</p>
            <div class="row"><button class="btn" disabled={busy} onClick={() => set(false)}>Stop sharing</button></div>
          </>
        )}
        {err && info && <p class="err">{err}</p>}
      </div>
    </div>
  );
}

function Empty({ go }: { go: () => void }) {
  return (
    <div class="empty">
      <h2>No projects yet</h2>
      <p>Bring in a folder of footage, or tell your agent where it is.</p>
      <button class="btn primary" onClick={go}>Go to the inbox</button>
    </div>
  );
}

/* ---------------- Start ---------------- */

const SAY = "Edit my videos with Yap Machine: https://github.com/iamredmh/yap-machine — the footage is in ~/Movies/raw-takes";

function Copy({ text }: { text: string }) {
  const [state, setState] = useState("Copy");
  return <button class="btn small" onClick={async () => {
    try { await navigator.clipboard.writeText(text); setState("Copied"); } catch { setState("Select and copy"); }
    setTimeout(() => setState("Copy"), 1600);
  }}>{state}</button>;
}

function Start() {
  const [doc, setDoc] = useState<any>(null);
  const run = () => { setDoc(null); api.get("/api/doctor").then(setDoc).catch(() => setDoc({ engine: false, checks: [], fixes: [], error: "The desk couldn't reach its own server, so it couldn't ask.", install: "./scripts/install" })); };
  useEffect(run, []);
  const st = doctorStatus(doc);
  return (
    <section class="view">
      <div class="view-head"><div>
        <span class="label">Get going</span>
        <h1>You talk. Your agent edits. You leave notes.</h1>
        <p class="muted">Yap Machine is free and runs on your own computer. The editing is done by the agent you already use, with free local tools doing the heavy lifting.</p>
      </div></div>
      <div class="grid2">
        <div class="panel pad">
          <span class="label">Say this to your agent</span>
          <p class="say">Edit my videos with Yap Machine: <a href="https://github.com/iamredmh/yap-machine" target="_blank" rel="noreferrer">github.com/iamredmh/yap-machine</a>. The footage is in ~/Movies/raw-takes.</p>
          <div class="row"><Copy text={SAY} /><span class="faint small">Claude Code, Codex, Cursor, Gemini CLI</span></div>
        </div>
        <div class="panel pad">
          <span class="label">Or connect your agent yourself</span>
          <div class="cmd"><span>node desk/dist/cli/index.js setup --local</span><Copy text="node desk/dist/cli/index.js setup --local" /></div>
          <p class="muted small">Run from the Yap Machine folder to connect your installed agents. <span class="mono">./scripts/start-desk</span> opens this desk any time.</p>
        </div>
      </div>
      <div class="panel pad">
        <div class="row between"><div><span class="label">Your machine</span><h2 style="margin-top:4px" role="status">{st.headline}</h2></div>
          <button class="btn small" onClick={run}>Check again</button></div>
        {st.kind === "down" ? (
          <div class="down" role="alert">
            <p>Yap Machine's editing engine didn't answer, so none of the tools below could be checked. It said:</p>
            <pre class="log">{st.error}</pre>
            <p class="small">Install it with <a href="https://docs.astral.sh/uv/" target="_blank" rel="noreferrer">uv</a>, then run:</p>
            <div class="cmd"><span>{st.install}</span><Copy text={st.install} /></div>
          </div>
        ) : (
          <>
            <p class="muted small">Yap Machine doesn't bundle these. It uses free tools you may already have.</p>
            <div>
              {doc?.checks.map((c: any, i: number) => (
                <div class="check"><span class={"tick " + (c.ok ? "yes" : "no")} aria-hidden="true">{c.ok ? "✓" : "!"}</span>
                  <div><b style="font-weight:600">{c.name}</b> <span class="muted">· {c.why}</span></div>
                  <span class={c.ok ? "faint small" : "pill warn"}>{c.ok ? "ready" : c.required ? "missing" : "optional"}</span>
                  {!c.ok && doc.fixes[doc.checks.filter((x: any, j: number) => !x.ok && j < i).length] && <code>{doc.fixes[doc.checks.filter((x: any, j: number) => !x.ok && j < i).length]}</code>}
                </div>
              ))}
            </div>
          </>
        )}
        <p class="fine">Preparing new footage needs whisper.cpp and a speech model. The checks above show what is ready and how to install anything missing.</p>
      </div>
      <div class="panel pad">
        <span class="label">How this desk talks to your agent</span>
        <div class="flow">
          <div><b>This desk</b><span class="muted small">Notes, chat, files you attach, changes to the look.</span></div>
          <div><b>Yap Machine, on this computer</b><span class="muted small">Keeps it all and hands it over as one batch.</span></div>
          <div><b>Your agent</b><span class="muted small">Picks the batch up, makes the next version, replies here.</span></div>
        </div>
      </div>
    </section>
  );
}

/* ---------------- Inbox ---------------- */

function Inbox({ projects, jobs, home, onOpen }: { projects: any[]; jobs: any[]; home: string; onOpen: (id: string) => void }) {
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [imported, setImported] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const locked = busy || adding;
  const bring = async () => {
    if (locked) return;
    setErr("");
    if (!path.trim()) { setErr("Paste the path of a footage folder first."); return; }
    setBusy(true);
    try { const job = await api.post("/api/projects", { footage: path.trim().replace(/^["']|["']$/g, ""), name: name.trim() || undefined }); setImported(job.project); setPath(""); setName(""); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };
  const uploadFootage = async (files: FileList | null) => {
    if (!files?.length || locked) return;
    setErr("");
    if (files.length > 30 || Array.from(files).reduce((n, f) => n + f.size, 0) > 500 * 1024 * 1024) {
      setErr("Choose up to 30 files and 500 MB in total. For a larger shoot, import its folder below."); return;
    }
    if (Array.from(files).some(f => !f.size || !/\.(mp4|mov|m4v|webm|mkv|wav|mp3|m4a|aac)$/i.test(f.name))) {
      setErr("Choose a video or audio file: MP4, MOV, M4V, WebM, MKV, WAV, MP3, M4A or AAC."); return;
    }
    const form = new FormData(); for (const f of Array.from(files)) form.append("files", f); form.append("name", name.trim());
    setAdding(true);
    try { const job = await api.post("/api/footage", form); setImported(job.project); setName(""); }
    catch (e) { setErr((e as Error).message); }
    finally { setAdding(false); }
  };
  const running = jobs.filter((j) => j.state !== "done");
  const added = projects.find(p => p.id === imported);
  const importJob = jobs.find(j => j.project === imported);
  const prepared = importJob?.state === "done";
  const preparationFailed = importJob?.state === "failed";
  return (
    <section class="view footage-view">
      <header class="footage-heading"><div><span class="label">01 / Your footage</span><h1>Good stories start with <em>you.</em></h1><p class="muted">Bring your takes. We’ll help you turn them into a video worth sharing.</p></div><span class="local-tag"><StudioIcon name="check"/>Your files stay on this computer</span></header>
      <div class="import-layout">
        <div class="import-main">
          <div class={"footage-drop" + (dragging ? " dragging" : "") + (adding ? " is-adding" : "")} aria-busy={adding} onDragOver={e => { e.preventDefault(); if (!locked) setDragging(true); }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }} onDrop={e => { e.preventDefault(); setDragging(false); void uploadFootage(e.dataTransfer?.files ?? null); }}>
            <div class="upload-art" aria-hidden="true"><span class="upload-card back"><StudioIcon name="film"/></span><span class="upload-card front"><StudioIcon name="export"/></span></div>
            <h2>{adding ? "Bringing in your footage…" : dragging ? "Drop to start your project" : "Drop in your footage"}</h2>
            <p class="muted">Video or audio. One take or a whole batch.</p>
            <button class="btn primary" disabled={locked} onClick={() => input.current?.click()}><StudioIcon name="plus"/>{adding ? "Adding files…" : "Choose files"}</button>
            <input ref={input} class="sr" aria-label="Video and audio files" tabIndex={-1} type="file" multiple disabled={locked} accept=".mp4,.mov,.m4v,.webm,.mkv,.wav,.mp3,.m4a,.aac" onChange={e => { void uploadFootage(e.currentTarget.files); e.currentTarget.value = ''; }}/>
            <p class="fine" role="status">{adding ? "Keep this page open while your files are copied." : "MP4, MOV, WebM + audio · Up to 30 files / 500 MB"}</p>
          </div>
          <div class="import-settings"><label class="field" for="project-name"><span>Project name <span class="faint">(optional)</span></span><input id="project-name" placeholder="e.g. A little behind the scenes" maxLength={100} value={name} disabled={locked} onInput={e => setName(e.currentTarget.value)}/></label><p class="fine">Leave it blank to use your first file’s name.</p></div>
          {err && <div class="import-message error" role="alert">{err}</div>}
          {imported && <div class="import-message" role="status"><div><b>{added?.versions.length ? "Your cut is ready" : prepared ? "Ready for your agent" : preparationFailed ? "Preparation paused" : "Footage added"}</b><p>{added?.versions.length ? "Watch it through and leave a note on any moment." : prepared ? "Your sources and transcript are ready. Open your project to ask your agent for a first cut." : preparationFailed ? "Your files are safe. Check the preparation details below to continue." : "We’re finding your sources and transcribing the audio. You can keep working while we prepare your project."}</p></div>{added && <button class="btn" onClick={() => onOpen(imported)}>{added.versions.length ? "Review cut" : "Open project"}<StudioIcon name="arrow"/></button>}</div>}
          <details class="folder-import"><summary><StudioIcon name="folder"/><span>Working with a larger shoot?<small>Import a folder without copying your files.</small></span><StudioIcon name="chevron"/></summary><div class="bring">
            <div class="field"><label for="fpath">Footage folder</label><input id="fpath" placeholder="/Users/you/Movies/raw-takes" value={path} disabled={locked} onInput={e => setPath(e.currentTarget.value)} onKeyDown={e => { if(e.key === 'Enter') void bring(); }}/></div>
            <button class="btn" disabled={locked} onClick={bring}>{busy ? "Importing…" : "Import folder"}<StudioIcon name="arrow"/></button>
            <p class="fine">In Finder, hold Option and right-click your folder, then choose Copy as Pathname.</p><details class="storage-location"><summary>Where projects are stored</summary><p class="fine">{home}</p></details>
          </div></details>
        </div>
        <aside class="journey-card" aria-label="How it works"><span class="label">From first take to final cut</span><h2>A little less editing.<br/><em>A lot more you.</em></h2><ol><li><span>01</span><div><h3>Bring your footage</h3><p>Add your takes. Your agent finds the words and gets everything ready.</p></div></li><li><span>02</span><div><h3>Make the cut yours</h3><p>Watch your agent’s edit. Leave a note on any moment you’d like to change.</p></div></li><li><span>03</span><div><h3>Give it your signature</h3><p>Choose a look, add effects and export a video ready to share.</p></div></li></ol><div class="journey-finish"><StudioIcon name="sparkle"/><span>Your voice. Your style. Your video.</span></div></aside>
      </div>
      {(projects.length > 0 || running.length > 0) && <div class="project-heading"><div><span class="label">Pick up where you left off</span><h2>Your projects <span>{projects.length}</span></h2></div><p class="fine">All your takes, cuts and creative decisions, together.</p></div>}
      {running.map(j => <div class="import-job" key={j.project}><div class="row between"><h3>{projects.find(p => p.id === j.project)?.name ?? j.project}</h3><span class={"pill " + (j.state === "failed" ? "rec" : j.state === "done" ? "ok" : "warn")}><span class="dot"/>{j.state === "running" ? "Preparing footage" : j.state === "done" ? "Ready for your agent" : "Preparation paused"}</span></div><p class="muted">{j.state === "failed" ? "Your files are safe. Check the details below, then retry preparation." : "Finding your sources and transcribing the audio. You can keep using Yap Machine."}</p>{j.state === "failed" && <button class="btn" onClick={() => api.post(`/api/projects/${j.project}/prepare`, {}).catch(e => setErr(e.message))}>Retry preparation</button>}<details><summary>Preparation details</summary><pre class="log">{j.lines.slice(-12).join("\n") || "Starting…"}</pre></details></div>)}
      <div class="project-grid">{projects.map(p => <ProjectCard key={p.id} p={p} onOpen={onOpen}/>)}</div>
    </section>
  );
}

function ProjectCard({ p, onOpen }: { p: any; onOpen: (id: string) => void }) {
  const latest = p.versions.at(-1);
  const poster = latest?.render ? `/poster/${encodeURIComponent(p.id)}/${latest.render.split("/")[1]}?t=2` : null;
  return <article class="project-card"><button class="project-cover" onClick={() => onOpen(p.id)} aria-label={`${latest ? "Review" : "Open"} ${p.name}`}>
    {poster ? <img src={poster} alt="" loading="lazy"/> : <StudioIcon name="film"/>}<span class="project-cover-action"><StudioIcon name={latest ? "play" : "arrow"}/></span><span class="project-cut-tag">{latest ? `${latest.version} · ${tc(latest.duration)}` : "New project"}</span>
    </button><div class="project-info"><h3>{p.name}</h3><p>{p.sources.length} source{p.sources.length === 1 ? "" : "s"} · {p.versions.length ? `${p.versions.length} cut${p.versions.length === 1 ? "" : "s"}` : p.phrases ? "Ready for your agent" : "Preparing footage"}{p.shorts.length ? ` · ${p.shorts.length} shorts` : ""}</p><div class="project-card-footer">{latest ? <StatusPill status={versionStatus(latest)}/> : <span class="fine">Your first cut is next</span>}<button class="btn" onClick={() => onOpen(p.id)}>{latest ? "Review cut" : "Open project"}<StudioIcon name="arrow"/></button></div><details class="project-source-details"><summary>Source details</summary><div>{p.sources.map((source: any) => <p key={source.id}><b>{source.id}</b> · {source.kind}{source.duration ? ` · ${tc(source.duration)}` : ""}{source.note ? ` · ${source.note}` : ""}</p>)}<p class="fine">{p.footage}</p></div></details></div></article>;
}

/* ---------------- Review ---------------- */

type SideTab = "transcript" | "notes" | "checks" | "left";

function Icon({ kind }: { kind: "fwd" | "back" | "pause" }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      {kind === "pause" ? <path d="M3.5 2h2.5v10H3.5zM8 2h2.5v10H8z" fill="currentColor" />
        : kind === "fwd" ? <path d="M2 2l5 5-5 5zM7.5 2l5 5-5 5z" fill="currentColor" />
        : <path d="M12 2L7 7l5 5zM6.5 2l-5 5 5 5z" fill="currentColor" />}
    </svg>
  );
}

const SHORTCUTS: [string, string][] = [
  ["Space or K", "Play and pause"],
  ["L", "Play forward; again for 2x, then 4x"],
  ["J", "Play backward at 1x; again for 2x, then 4x"],
  ["Left, Right", "One frame back or forward (Shift: 10 frames)"],
  ["Home, End", "Start or end of the cut"],
  ["[ or ]", "Previous or next note or join to look at"],
  ["N", "Next note (Shift+N: previous), in the filter chosen in the Notes tab"],
  ["V", "Compare this version with another: two videos side by side, kept on the same words"],
  ["H", "While comparing, switch which video you hear"],
  ["+ or -", "Zoom the timeline in or out, about the playhead"],
  ["0", "Show the whole cut on the timeline"],
  ["< or >", "Slower or faster, 0.25x to 2x (Space plays at that speed, and it's remembered)"],
  ["R", "Loop on or off (the whole cut, or the range below)"],
  ["I, O", "Set the loop start and end at this moment"],
  ["X", "Clear the loop range"],
  ["C", "Pause and write a note at this moment"],
  ["M", "Mute or unmute"],
  ["F", "Full screen"],
  ["?", "This list"],
  ["Esc", "Close this list"],
];

function Shortcuts({ onClose }: { onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    close.current?.focus();
    return () => back?.focus?.({ preventScroll: true });
  }, []);
  return (
    <div class="lightbox" onClick={onClose}>
      <div class="lightbox-card sheet-keys" role="dialog" aria-modal="true" aria-labelledby="keys-title" onClick={(e) => e.stopPropagation()}>
        <div class="row between"><h2 id="keys-title">Keyboard shortcuts</h2><button ref={close} class="btn small" onClick={onClose}>Close</button></div>
        <dl class="keys">
          {SHORTCUTS.map(([k, d]) => <><dt>{k.split(/ or |, /).map((x, i) => <>{i > 0 && <span class="faint"> {k.includes(" or ") ? "or" : ","} </span>}<kbd>{x}</kbd></>)}</dt><dd>{d}</dd></>)}
        </dl>
        <p class="fine">Keys are ignored while you're typing a note, and when Ctrl, Cmd or Alt is held. The timeline works with the arrow keys too: click it, or Tab to it. On the timeline you can also pinch, or hold Ctrl and scroll, to zoom, and scroll sideways to move along.</p>
      </div>
    </div>
  );
}

function Review({ project, desk, stamp, waitingCount, focus, setFocus, initialVersion, onVersion, onStyle, onChat }: { project: any; desk: any; stamp: number; waitingCount: number; focus: boolean; setFocus: (f: boolean) => void; initialVersion?: string; onVersion: (v: string) => void; onStyle: () => void; onChat: () => void }) {
  const versions = project.versions;
  const [v, setV] = useState<string>(versions.some((x: any) => x.version === initialVersion) ? initialVersion! : versions.at(-1)?.version ?? "");
  const [data, setData] = useState<any>(null);
  const [t, setT] = useState(0);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [tab, setTab] = useState<SideTab>("transcript");
  const [sheet, setSheet] = useState<{ src: string; title: string } | null>(null);
  const [help, setHelp] = useState(false);
  const [detail, setDetail] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [addingNote, setAddingNote] = useState(false);
  const notePending = useRef(false);
  useEffect(() => { if (v) onVersion(v); }, [v]);
  const [play, setPlay] = useState<Play>(PAUSED);
  const [flash, setFlash] = useState<{ text: string; icon?: "fwd" | "back" | "pause" } | null>(null);
  // the speed Space plays at is remembered, across versions and visits; looping and its range are per version
  const [speed, setSpeedState] = useState(() => readSpeed(store.get(SPEED_KEY)));
  const [loopOn, setLoopOn] = useState(false);
  const [range, setRange] = useState<LoopRange>(NO_RANGE);
  // the stretch of the cut on the timeline; null is the whole cut
  const [zoom, setZoom] = useState<Win | null>(null);
  const [muted, setMuted] = useState(false);
  // compare: the version beside this one, which of the two you hear, and whether the older one has the moment on screen
  const [cmp, setCmp] = useState<string | null>(null);
  const [dataA, setDataA] = useState<any>(null);
  const [hear, setHear] = useState<"a" | "b">("b");
  const [aNot, setANot] = useState(false);
  const vidA = useRef<HTMLVideoElement>(null);
  // notes: which states to show, the one you last stepped to, and older versions' cuts (to find their notes in this version)
  const [noteFilter, setNoteFilter] = useState<NoteFilter>("all");
  const [activeNote, setActiveNote] = useState<string | null>(null);
  const [segsBy, setSegsBy] = useState<Record<string, any[]>>({});
  const holdA = useRef(false);
  const syncRef = useRef<() => void>(() => undefined);
  const soundRef = useRef({ muted: false, cmp: null as string | null, hear: "b" as "a" | "b" });
  const speedRef = useRef(speed);
  const loopRef = useRef({ on: false, range: NO_RANGE as LoopRange, dur: 1 });
  const vid = useRef<HTMLVideoElement>(null);
  const player = useRef<HTMLDivElement>(null);
  const noteBox = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const playRef = useRef<Play>(PAUSED);
  const reverse = useRef<number | undefined>(undefined);
  const flashTimer = useRef<number | undefined>(undefined);
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  const info = versions.find((x: any) => x.version === v);
  useEffect(() => { if (!versions.some((x: any) => x.version === v) && versions.length) setV(versions.at(-1).version); }, [versions.length]);
  useEffect(() => {
    if (!v) return;
    setData((d: any) => (d?.version === v ? d : null));
    api.get(`/api/projects/${project.id}/versions/${v}`).then(setData).catch(() => setData(null));
  }, [v, stamp]);
  const dur = data?.duration || info?.duration || 1;
  loopRef.current = { on: loopOn, range, dur };
  const otherOf = (x: string) => { const i = versions.findIndex((y: any) => y.version === x); return (versions[i - 1] ?? versions[i + 1])?.version ?? null; };
  const infoA = cmp ? versions.find((x: any) => x.version === cmp) : null;
  const ready = !!(cmp && data && dataA && data.version === v && dataA.version === cmp);
  const diff = useMemo(() => (ready ? diffCuts(dataA.segments, data.segments) : null), [ready, data, dataA]);
  const view = useMemo(() => (zoom ? clampView(zoom, dur) : fullView(dur)), [zoom, dur]);
  // the compare strip's older row shows the stretch of the older version that has the same words
  const viewA = useMemo(() => (ready ? viewInA(data.segments, dataA.segments, view, dataA.duration) : null), [ready, data, dataA, view]);
  useEffect(() => {
    if (!cmp) { setDataA(null); return; }
    if (cmp === v) { setCmp(otherOf(v)); return; }
    setDataA((d: any) => (d?.version === cmp ? d : null));
    api.get(`/api/projects/${project.id}/versions/${cmp}`).then(setDataA).catch(() => setDataA(null));
  }, [cmp, v, stamp]);
  /** Keep the older video on the same words as this one. */
  const syncA = () => {
    const a = vidA.current, b = vid.current;
    if (!cmp || !a || !b || !data || !dataA || data.version !== v || dataA.version !== cmp || holdA.current) return;
    const target = mapTime(data.segments, b.currentTime, dataA.segments);
    setANot(target === null);
    if (target === null) { if (!a.paused) a.pause(); return; }
    if (a.playbackRate !== b.playbackRate) a.playbackRate = b.playbackRate;
    if (Math.abs(a.currentTime - target) > (b.paused ? 0.03 : 0.3)) a.currentTime = target;
    if (!b.paused && a.paused) a.play().catch(() => undefined);
    else if (b.paused && !a.paused) a.pause();
  };
  syncRef.current = syncA;
  useEffect(() => {
    if (!cmp) return;
    const id = setInterval(() => syncRef.current(), 150);
    return () => clearInterval(id);
  }, [cmp]);
  // sound: one thing is heard at a time in Compare, and the mute button silences both
  soundRef.current = { muted, cmp, hear };
  const applySound = () => {
    const { muted: m, cmp: c, hear: h } = soundRef.current;
    if (vid.current) vid.current.muted = m || (!!c && h === "a");
    if (vidA.current) vidA.current.muted = m || h === "b";
  };
  useEffect(applySound, [muted, cmp, hear, v, stamp, data, dataA]);
  const toggleCompare = () => { const next = cmp ? null : otherOf(v); setCmp(next); setANot(false); say(next ? `Compare ${next} with ${v}` : "Compare off"); };
  const seekA = (at: number) => {
    // the older video goes where you pointed, and stays there until this one plays or moves
    applyPlay(PAUSED);
    holdA.current = true;
    if (vidA.current) vidA.current.currentTime = at;
  };
  const nowIdx = data ? data.segments.findIndex((s: any) => t >= s.t && t < s.e) : -1;
  useEffect(() => {
    if (tab !== "transcript" || !vid.current || vid.current.paused) return;
    // scroll the transcript only: scrollIntoView would also scroll the page, and on a phone that carries the video off the screen
    const box = list.current, row = box?.querySelector<HTMLElement>(".seg.now");
    if (!box || !row) return;
    const b = box.getBoundingClientRect(), r = row.getBoundingClientRect();
    if (r.top < b.top || r.bottom > b.bottom) box.scrollTo({ top: box.scrollTop + (r.top - b.top) - box.clientHeight / 3, behavior: "smooth" });
  }, [nowIdx, tab]);

  const notes = desk.notes.filter((n: any) => n.project === project.id && n.version === v);
  const joinItems = data?.joins && !data.joins.stale ? data.joins.items : [];
  // notes left on an older version that the agent says it fixed in this one: shown here, at the same words, so you can check them
  // (in any state: one you send back from here stays here, waiting, until the agent says it fixed it somewhere else)
  const carriedRaw = useMemo(() => desk.notes.filter((n: any) => n.project === project.id && n.version !== v && n.fixedIn === v), [desk.notes, project.id, v]);
  const needVersions = [...new Set(carriedRaw.map((n: any) => n.version as string))].sort().join(",");
  useEffect(() => {
    for (const ver of needVersions.split(",").filter(Boolean)) {
      if (segsBy[ver]) continue;
      api.get(`/api/projects/${project.id}/versions/${encodeURIComponent(ver)}`).then((d) => setSegsBy((m) => ({ ...m, [ver]: d.segments }))).catch(() => undefined);
    }
  }, [needVersions, project.id, stamp]);
  const carried = useMemo(() => (data?.version === v
    ? carriedRaw.map((n: any) => ({ ...n, here: segsBy[n.version] ? mapTime(segsBy[n.version], n.at, data.segments) : undefined }))
    : []), [carriedRaw, segsBy, data, v]);
  const markers = useMemo(() => markersFor([...notes, ...carried.filter((n: any) => typeof n.here === "number").map((n: any) => ({ ...n, at: n.here }))], joinItems), [desk.notes, project.id, v, data, carried]);
  const allNotes = [...notes, ...carried];
  const counts = noteCounts(allNotes);
  // the notes N and Shift+N step through: this version's and the carried ones, in the filter you chose, in time order
  const steppable = filterNotes(allNotes, noteFilter)
    .map((n: any) => ({ id: n.id, t: n.version === v ? n.at : n.here }))
    .filter((x: any) => typeof x.t === "number")
    .sort((x: any, y: any) => x.t - y.t);
  const stepNote = (dir: 1 | -1) => {
    const el = vid.current; if (!el) return;
    const cur = el.currentTime;
    const to = dir === 1 ? steppable.find((x) => x.t > cur + 0.05) : [...steppable].reverse().find((x) => x.t < cur - 0.4);
    const which = noteFilter === "all" ? "" : ` ${NOTE_FILTERS.find(([k]) => k === noteFilter)![1].toLowerCase()}`;
    if (!to) { say(dir === 1 ? `No later${which} notes` : `No earlier${which} notes`); return; }
    goTo(to.t); setActiveNote(to.id);
    say(`Note ${steppable.indexOf(to) + 1} of ${steppable.length}${which ? ` (${which.trim()})` : ""}`);
    if (tab === "notes") setTimeout(() => document.getElementById(`note-${to.id}`)?.scrollIntoView({ block: "nearest" }), 30);
  };

  // ---- the keyboard: Space/K play, J and L change speed (J is emulated, browsers can't play backwards), arrows step frames ----
  const stopReverse = () => { if (reverse.current !== undefined) { clearInterval(reverse.current); reverse.current = undefined; } };
  const say = (text: string, icon?: "fwd" | "back" | "pause") => {
    setFlash({ text, icon });
    clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 1500);
  };
  const setState = (p: Play) => { playRef.current = p; setPlay(p); };
  const goTo = (s: number) => {
    const el = vid.current; if (!el) return;
    const x = Math.min(Math.max(0, s), dur);
    el.currentTime = x; setT(x);
  };
  const applyPlay = (p: Play) => {
    const el = vid.current; if (!el) return;
    stopReverse();
    setState(p);
    if (p.dir === 1) { el.playbackRate = p.rate; el.play().catch(() => undefined); }
    else {
      el.pause(); el.playbackRate = speedRef.current;
      if (p.dir === -1) {
        reverse.current = window.setInterval(() => {
          const e = vid.current; if (!e || e.seeking) return;
          const next = e.currentTime - p.rate * 0.1;
          const L = loopRef.current, ranged = L.on && hasRange(L.range);
          const floor = ranged ? (L.range.in ?? 0) : 0;
          if (next <= floor + 0.02) {
            // looping: carry on from the other end; otherwise stop at the start
            if (L.on) { e.currentTime = ranged ? (L.range.out ?? L.dur) : L.dur; return; }
            e.currentTime = 0; setT(0); stopReverse(); setState(PAUSED); say("Start", "pause"); return;
          }
          e.currentTime = next;
        }, 100);
      }
    }
    say(playLabel(p), p.dir === 1 ? "fwd" : p.dir === -1 ? "back" : "pause");
  };
  const changeSpeed = (x: number) => {
    const old = speedRef.current;
    speedRef.current = x; setSpeedState(x); store.set(SPEED_KEY, String(x));
    const el = vid.current, cur = playRef.current;
    if (el && cur.dir === 1 && cur.rate === old) { el.playbackRate = x; setState({ dir: 1, rate: x }); }   // playing at the old speed: follow it
    else if (el && cur.dir === 0) el.playbackRate = x;
    say(`Speed ${speedLabel(x)}`);
  };
  const toggleLoop = () => {
    const next = !loopRef.current.on;
    setLoopOn(next);
    say(next ? (hasRange(range) ? `Loop ${rangeLabel(range, dur)}` : "Loop on") : "Loop off");
  };
  // setting an end turns the loop on: that is what you set it for
  const setLoopEdge = (edge: "in" | "out") => {
    const el = vid.current; if (!el) return;
    const next = setEdge(range, edge, el.currentTime, dur);
    setRange(next); setLoopOn(true);
    say(`Loop ${edge === "in" ? "start" : "end"} ${clock(el.currentTime)}`);
  };
  const clearLoop = () => { setRange(NO_RANGE); say("Loop range cleared"); };
  /** Returns true when the key was ours. */
  const act = (a: KeyAction): boolean => {
    if (a.type === "help") { setHelp((h) => !h); return true; }
    if (a.type === "close") { if (!help) return false; setHelp(false); return true; }
    const el = vid.current; if (!el) return false;
    switch (a.type) {
      case "play": applyPlay(press(playRef.current, a.key, speedRef.current)); return true;
      case "speed": changeSpeed(stepSpeed(speedRef.current, a.dir)); return true;
      case "loop": toggleLoop(); return true;
      case "loopEdge": setLoopEdge(a.edge); return true;
      case "loopClear": clearLoop(); return true;
      case "step": {
        applyPlay(PAUSED);
        const x = stepFrames(el.currentTime, data?.fps ?? 25, a.frames, dur);
        el.currentTime = x; setT(x);
        say(`${a.frames > 0 ? "+" : "−"}${Math.abs(a.frames)} frame${Math.abs(a.frames) > 1 ? "s" : ""}`);
        return true;
      }
      case "nudge": goTo(el.currentTime + a.seconds); say(`${a.seconds > 0 ? "+" : "−"}${Math.abs(a.seconds)} s`); return true;
      case "home": goTo(0); say("Start"); return true;
      case "end": goTo(dur); say("End"); return true;
      case "zoom": case "zoomFit": {
        setDetail(true);
        const next = keyZoom(view, a.type === "zoomFit" ? "fit" : a.dir > 0 ? "in" : "out", el.currentTime, dur);
        setZoom(next); say(a.type === "zoomFit" || next.end - next.start >= dur - 1e-6 ? "Whole cut" : `Zoom ${(dur / (next.end - next.start)).toFixed(1).replace(/\.0$/, "")}x`);
        return true;
      }
      case "mute": setMuted(!muted); say(!muted ? "Muted" : "Sound on"); return true;
      case "compare": if (versions.length > 1) toggleCompare(); return true;
      case "noteStep": stepNote(a.dir); return true;
      case "hear": if (cmp) { setHear(hear === "a" ? "b" : "a"); say(`Hearing ${hear === "a" ? v : cmp}`); } return true;
      case "fullscreen": if (document.fullscreenElement) void document.exitFullscreen(); else if (player.current?.requestFullscreen) void player.current.requestFullscreen().catch(() => undefined);
        else (el as HTMLVideoElement & { webkitEnterFullscreen?: () => void }).webkitEnterFullscreen?.();   // iPhone: only the video itself can go full screen
        return true;
      case "note": applyPlay(PAUSED); setFocus(false); setNoteOpen(true); requestAnimationFrame(() => noteBox.current?.focus()); return true;
      case "marker": {
        const r = stepMarker(markers, el.currentTime, a.dir);
        if (r) { goTo(r.marker.seekAt); say(`${r.marker.kind === "note" ? "Note" : "Join"} ${r.index + 1} of ${markers.length}`); }
        else say(a.dir > 0 ? "No later notes or joins" : "No earlier notes or joins");
        return true;
      }
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented) return;
    const a = keyAction(e); if (!a) return;
    const el = e.target as HTMLElement | null;
    if (isTyping(el) || sheet) return;
    if (!help && document.querySelector("[role=dialog][aria-modal]")) return;
    if (help && a.type !== "close" && a.type !== "help") return;
    // Space on a focused button, link or tab presses it, unless it is one of the buttons that plays the video
    if (a.type === "play" && a.key === "toggle" && el?.closest("button, a[href], summary, [role=tab]") && !el.closest("[data-seek]")) return;
    if (act(a)) e.preventDefault();
  };
  keyRef.current = onKey;
  useEffect(() => {
    const on = (e: KeyboardEvent) => keyRef.current(e);
    addEventListener("keydown", on);
    return () => { removeEventListener("keydown", on); stopReverse(); clearTimeout(flashTimer.current); };
  }, []);
  // a new version or a re-render starts paused
  useEffect(() => { stopReverse(); setState(PAUSED); setT(0); }, [v, stamp]);
  useEffect(() => { setRange(NO_RANGE); setLoopOn(false); setZoom(null); }, [v]);
  // looping the whole cut is the browser's own; a range is watched here (a jump back to its start when it reaches its end)
  useEffect(() => { if (vid.current) vid.current.loop = loopOn && !hasRange(range); }, [loopOn, range, v, stamp, data]);
  useEffect(() => {
    if (!loopOn || !hasRange(range)) return;
    const id = setInterval(() => {
      const el = vid.current;
      if (!el || el.paused || el.seeking) return;
      const j = loopJump(el.currentTime, range, dur, 1);
      if (j !== null) el.currentTime = j;
    }, 30);
    return () => clearInterval(id);
  }, [loopOn, range, dur]);

  if (!versions.length) return <section class="review-waiting"><span class="label">02 / Review your cut</span><StudioIcon name="film"/><h1>Your story is taking shape.</h1><p>Your footage is in <b>{project.name}</b>. Once preparation finishes, ask your agent to make the first cut.</p><button class="btn primary" onClick={onChat}>Open agent chat<StudioIcon name="arrow"/></button><span class="fine">Try “Cut this into a short video for social media.”</span></section>;

  const tall = (data?.height ?? 0) > (data?.width ?? 1);
  const seek = (s: number) => { if (vid.current) { vid.current.currentTime = s; vid.current.play().catch(() => undefined); } };
  const add = async (txt = text, at?: number) => {
    if (notePending.current) return;
    setErr("");
    if (!txt.trim()) { setErr("Type a note first."); return; }
    notePending.current = true;
    setAddingNote(true);
    try {
      await api.post("/api/notes", { project: project.id, version: v, at: at ?? vid.current?.currentTime ?? t, text: txt });
      setText(current => current === txt ? "" : current);
      setTab("notes");
    } catch (e) { setErr((e as Error).message); }
    finally { notePending.current = false; setAddingNote(false); }
  };
  const send = async () => { setErr(""); try { await api.post(`/api/projects/${project.id}/send`, { version: v }); } catch (e) { setErr((e as Error).message); } };
  const reasonFor: Record<number, string> = {};
  data?.reasons.forEach((r: any) => { if (r.why) reasonFor[r.range] = r.why; });
  const seen = new Set<number>();
  // `anchor`: only the Notes tab's copy of a note carries its id (the list under the video shows some of the same notes)
  const row = (n: any, anchor = false) => n.version === v
    ? <NoteRow n={n} seek={seek} active={activeNote === n.id} anchor={anchor} />
    : <NoteRow n={n} seek={seek} at={n.here === undefined ? n.at : n.here} origin={n.version} here={v} active={activeNote === n.id} anchor={anchor} />;
  const shownHere = filterNotes(notes, noteFilter);
  const shownCarried = filterNotes(carried, noteFilter);
  // one status, from the check and the join report together: the header, the tab badge and the Checks tab all say the same thing
  const status = versionStatus(info);
  // join warnings are listed in the Joins section from joins.json (which may be newer than qc.md): they are counted once, there
  const generalWarnings = info?.check ? info.check.warnings.filter((x: string) => !isJoinWarning(x)) : [];
  const openChecks = () => { setFocus(false); setTab("checks"); };
  const poster = info?.render ? `/poster/${encodeURIComponent(project.id)}/${info.render.split("/")[1]}?t=1` : undefined;
  const persistent = play.dir === -1 || (play.dir === 1 && play.rate !== 1);
  const badge = flash ?? (persistent ? { text: playLabel(play), icon: play.dir === 1 ? "fwd" as const : "back" as const } : null);

  return (
    <section class={"work review-work" + (focus ? " focus" : "")}>
      <header class="review-heading"><h1>Review your cut<span>.</span></h1><KeySelect class="review-version" label="Cut to review" value={v} options={versions.map((x: any) => ({ value: x.version, label: `${x.version} · ${tc(x.duration)}` }))} onPick={setV}/><span class="spacer"/><span class="review-step-caption">Next, make it look like you.</span><button class="btn primary review-continue" disabled={!info?.render} onClick={onStyle}>Style this cut<StudioIcon name="arrow"/></button></header>
      <div class="stagecol">
        <div class="stagebar"><span class="review-preview-label"><span class="dot"/>Your cut</span>{info && <StatusPill status={status} onClick={openChecks}/>}<span class="spacer"/>
          {versions.length > 1 && <button class="vs-stage-btn" aria-pressed={!!cmp} onClick={hit(toggleCompare)} title="Compare versions (V)" aria-keyshortcuts="V"><StudioIcon name="compare"/>Compare</button>}
          <button class="vs-icon-btn" aria-expanded={detail} aria-label={detail ? "Hide detail" : "Timeline detail"} title={detail ? "Hide timeline detail" : "Show timeline detail"} onClick={() => setDetail(!detail)}><StudioIcon name="timeline"/></button>
          <button class="vs-stage-btn" aria-pressed={focus} onClick={() => setFocus(!focus)} title="Give the video more space"><StudioIcon name={focus ? "minimize" : "expand"}/>{focus ? "Show panels" : "Focus"}</button>
          <button class="vs-icon-btn review-help" aria-label="Keyboard shortcuts" onClick={() => setHelp(true)} title="Keyboard shortcuts (?)"><StudioIcon name="keyboard"/></button>
        </div>
        {cmp && <div class="review-compare-bar"><KeySelect class="cmp-with" label="Compare with" value={cmp} options={versions.filter((x: any) => x.version !== v).map((x: any) => ({ value: x.version, label: `Compare with ${x.version}` }))} onPick={x => { setCmp(x); setANot(false); }}/><div class="seg-ctl" role="group" aria-label="Which video you hear"><button aria-pressed={hear === "a"} onClick={hit(() => setHear("a"))}>Hear {cmp}</button><button aria-pressed={hear === "b"} onClick={hit(() => setHear("b"))}>Hear {v}</button></div></div>}
        <div class="stage">
          {info?.render
            ? <div class={"player" + (cmp ? " dual" : "")} ref={player} style={{ ["--ar" as any]: String(data?.width && data?.height ? data.width / data.height : 16 / 9) }}>
                <div class="review-canvas"><div class={"duo" + (cmp ? " two" : "")}>
                  {cmp ? (
                    <div class="vbox a">
                      {infoA?.render && <video ref={vidA} key={cmp + stamp} playsInline preload="metadata" src={media(project.id, infoA.render)} onLoadedMetadata={() => { applySound(); syncRef.current(); }}
                        onClick={() => applyPlay(press(playRef.current, "toggle", speedRef.current))} />}
                      <span class="vlabel">{cmp}{hear === "a" ? " · sound" : ""}</span>
                      {aNot && <div class="anot" role="status">Not in {cmp}</div>}
                    </div>
                  ) : null}
                  <div class="vbox b">
                  <video ref={vid} class={tall ? "tall" : ""} key={v + stamp} playsInline preload="metadata" src={media(project.id, info.render)} poster={poster}
                    onTimeUpdate={(e) => setT((e.target as HTMLVideoElement).currentTime)} onSeeked={(e) => { setT((e.target as HTMLVideoElement).currentTime); holdA.current = false; syncRef.current(); }}
                    onLoadedMetadata={(e) => { const el = e.target as HTMLVideoElement; el.playbackRate = speedRef.current; el.loop = loopRef.current.on && !hasRange(loopRef.current.range); applySound(); syncRef.current(); }}
                    onPlay={() => { holdA.current = false; const el = vid.current; if (el && playRef.current.dir !== 1) { stopReverse(); setState({ dir: 1, rate: el.playbackRate || 1 }); } syncRef.current(); }}
                    onPause={() => { if (playRef.current.dir === 1) setState(PAUSED); syncRef.current(); }}
                    onRateChange={() => { const el = vid.current; if (el && playRef.current.dir === 1 && el.playbackRate !== playRef.current.rate) setState({ dir: 1, rate: el.playbackRate }); syncRef.current(); }}
                    onClick={() => applyPlay(press(playRef.current, "toggle", speedRef.current))} />
                  <span class="vlabel" hidden={!cmp}>{v}{hear === "b" ? " · sound" : ""}</span>
                  {badge && <div class="badge" role="status">{badge.icon && <Icon kind={badge.icon} />}{badge.text}</div>}
                  </div>
                </div>
                </div>
                <ControlBar t={t} dur={dur} playing={play.dir !== 0} onToggle={() => applyPlay(press(playRef.current, "toggle", speedRef.current))} onStep={(n) => act({ type: "step", frames: n })}
                  speed={speed} onSpeed={changeSpeed} loopOn={loopOn} onLoop={toggleLoop} range={range} onEdge={setLoopEdge} onClear={clearLoop}
                  muted={muted} onMute={() => act({ type: "mute" })} onFullscreen={() => act({ type: "fullscreen" })} />
              </div>
            : <div class="empty" style="background:var(--paper)">Not rendered yet. Your agent renders with <span class="mono">yap-machine cut {v}</span>.</div>}
        </div>

        {cmp && diff && <DiffStrip a={cmp} b={v} durA={dataA.duration} durB={dur} diff={diff} viewA={viewA!} viewB={view} onSeekA={seekA} onSeekB={goTo} />}
        <div class={"timeline review-timeline" + (detail ? " detailed" : " simplified")}>{detail && <div class="review-timeline-heading"><span><StudioIcon name="timeline"/>Your cut <small>{data?.segments.length ?? 0} scenes</small></span></div>}
          <Timeline compact={!detail} wholeSecondTicks={!detail} project={project.id} version={v} rev={info?.render ? (data?.version === v ? data.renderRev : undefined) : null} dur={dur} fps={data?.fps ?? null} video={vid}
            segments={data?.segments} markers={markers} seek={goTo} act={act}
            range={range} loopOn={loopOn} onRange={(r) => { setRange(r); setLoopOn(true); }} view={view} onView={(w) => setZoom(w)} hideTime />
        </div>

        <div class="review-footer"><span>{counts.all - counts.resolved ? `${counts.all - counts.resolved} note${counts.all - counts.resolved === 1 ? '' : 's'} to work through` : "Watch it through. Make it yours."}</span><button class="linkbtn" onClick={() => { setFocus(false); setNoteOpen(true); requestAnimationFrame(() => noteBox.current?.focus()); }}>Leave a note<StudioIcon name="plus"/></button></div>
      </div>
      <aside class="side" aria-label={cmp ? "Changes between versions" : "Transcript, notes and checks"}>
        {cmp ? <ComparePanel a={cmp} b={v} diff={diff} segsA={dataA?.segments ?? []} segsB={data?.segments ?? []} durA={dataA?.duration ?? 0} durB={dur}
          notesA={desk.notes.filter((n: any) => n.project === project.id && n.version === cmp)} notesB={notes} onSeekA={seekA} onSeekB={goTo} onClose={() => setCmp(null)} /> : <>
        <ReviewTabs value={tab} onChange={setTab} items={[
          { id: "transcript", label: "Transcript" },
          { id: "notes", label: "Notes", badge: { count: counts.all - counts.resolved, title: `${counts.all - counts.resolved} not resolved` } },
          { id: "checks", label: "Checks", badge: { count: status.count ?? 0, title: status.label, tone: status.kind === "fix" ? "bad" : "warn" } },
          { id: "left", label: "Left out", badge: { count: data?.left?.length ?? 0 } },
        ]}/>
        <div class="side-body" ref={list} role="tabpanel" id={`review-panel-${tab}`} aria-labelledby={`review-tab-${tab}`}>
          <div class="review-side-intro"><span class="label">02 / Make it yours</span><h2><span class="review-editorial-title">{tab === "transcript" ? <>Every word. <em>Your story.</em></> : tab === "notes" ? <>A little <em>fine-tuning.</em></> : tab === "checks" ? <>The finishing <em>checks.</em></> : <>Another <em>take.</em></>}</span><span class="review-compact-title">{tab === "transcript" ? "Transcript" : tab === "notes" ? "Your notes" : tab === "checks" ? "Quality checks" : "Left out of this cut"}</span></h2><p>{tab === "transcript" ? "Click a line to watch that moment." : tab === "notes" ? "Your feedback, pinned to the right moment." : tab === "checks" ? "A second look at the sound and every cut." : "Good moments that didn’t make this version."}</p></div>
          {tab === "transcript" && (data?.segments.map((s: any) => {
            const first = !seen.has(s.range); seen.add(s.range);
            return (
              <button class={"seg" + (t >= s.t && t < s.e ? " now" : "")} data-seek onClick={() => seek(s.t + 0.01)}>
                <span class="mono">{tc(s.t)}</span>
                <span><span class="meta"><span class="beat">{s.beat}</span><span class={"pill " + s.layout}>{s.layout === "screen" ? "screen" : "camera"}</span></span><span>{s.text}</span></span>
                {first && reasonFor[s.range] && <span class="why">Why this take: {reasonFor[s.range]}</span>}
              </button>
            );
          }) ?? <p class="faint pad">Loading…</p>)}

          {tab === "notes" && (
            <div class="pad notes-tab">
              <div class="filters" role="group" aria-label="Show notes">
                {NOTE_FILTERS.map(([k, l]) => <button class="chipbtn" aria-pressed={noteFilter === k} onClick={hit(() => setNoteFilter(k))}>{l} <span class="n">{counts[k]}</span></button>)}
              </div>
              <div class="row between">
                <span class="faint small">{steppable.length} note{steppable.length === 1 ? "" : "s"} to step through</span>
                <span class="row" style="gap:6px">
                  <button class="btn small" onClick={hit(() => stepNote(-1))} disabled={!steppable.length} aria-keyshortcuts="Shift+N" title="Previous note (Shift+N)">Previous</button>
                  <button class="btn small" onClick={hit(() => stepNote(1))} disabled={!steppable.length} aria-keyshortcuts="N" title="Next note (N)">Next</button>
                </span>
              </div>
              {!allNotes.length && <p class="muted small">No notes on {v} yet. Use “Leave a note” to pin feedback to the moment you’re watching.</p>}
              {allNotes.length > 0 && !shownHere.length && !shownCarried.length && <p class="muted small">No notes here with that state.</p>}
              {shownHere.map((n: any) => row(n, true))}
              {shownCarried.length > 0 && <h3 class="grp-sm">From earlier versions, fixed in {v}</h3>}
              {shownCarried.map((n: any) => row(n, true))}
            </div>
          )}

          {tab === "checks" && info?.check && (
            <div class="pad">
              <div class="row between"><h3>Automated checks</h3><StatusPill status={status} /></div>
              {[...info.check.errors.map((x: string) => ["rec", x]), ...generalWarnings.map((x: string) => ["warn", x])].map(([k, x]) => <p class="small"><span class={"pill " + k} style="margin-right:6px">{k === "rec" ? "fix" : "look"}</span>{x}</p>)}
              {info.check.summary.map((x: string) => <p class="faint small">{x}</p>)}
            </div>
          )}
          {tab === "checks" && !info?.check && <p class="faint pad">This version hasn't been checked yet.</p>}
          {tab === "checks" && info?.render && (
            <Joins project={project.id} version={v} joins={data?.joins ?? null} jump={(at) => seek(Math.max(0, at - 1))}
              note={(j) => { add(`Check the join here: ${j.flags[0] ?? "listen to it"}`, j.at); setTab("notes"); }} open={setSheet} />
          )}

          {tab === "left" && (
            data?.left?.length ? data.left.slice(0, 80).map((p: any) => (
              <div class="take"><span class="mono faint small">{tc(p.at)}</span>
                <div><span>{p.text}</span><div class="row" style="margin-top:4px;gap:4px">{p.flags.map((f: string) => <span class={"pill " + (f === "cutoff" ? "rec" : f === "quiet" || f === "lowconf" ? "warn" : "face")}>{f === "lowconf" ? "unclear" : f}</span>)}</div></div>
                <button class="btn small" onClick={() => { add(`Use the take at ${tc(p.at)} of the raw footage instead (${p.id}): "${p.text.slice(0, 60)}${p.text.length > 60 ? "…" : ""}"`); setTab("notes"); }}>Use instead</button>
              </div>
            )) : <p class="muted small pad">Nothing was left out.</p>
          )}
        </div>
        </>}
        <div class={"review-note-compose" + (noteOpen ? " expanded" : "")}><button class="review-note-toggle" aria-expanded={noteOpen} onClick={() => setNoteOpen(!noteOpen)}>{noteOpen ? "Close note" : "Leave a note"}<StudioIcon name={noteOpen ? "chevron" : "plus"}/></button><div class="row between"><h3>Leave a note</h3><label class="mono composer-at" for="note">At {tc(t)}</label></div><p class="fine">Tell your agent what you’d like to change.</p><input id="note" ref={noteBox} placeholder="Tighten this pause, try another take…" value={text} onFocus={() => applyPlay(PAUSED)} onInput={e => setText(e.currentTarget.value)} onKeyDown={e => { if (e.key === "Enter") add(); }}/><div class="row between"><button class="btn" disabled={!text.trim() || addingNote} onClick={() => void add()}><StudioIcon name="plus"/>{addingNote ? "Adding…" : "Add note"}</button><button class="btn primary" onClick={send} disabled={!waitingCount}>Send to agent{waitingCount > 0 && <span class="count">{waitingCount}</span>}<StudioIcon name="arrow"/></button></div>{err && <p class="err" role="alert">{err}</p>}<p class="fine">Notes wait here until you send them.</p></div>
      </aside>
      {sheet && <Lightbox src={sheet.src} title={sheet.title} onClose={() => setSheet(null)} />}
      {help && <Shortcuts onClose={() => setHelp(false)} />}
    </section>
  );
}

/**
 * One note and where it is in its life. `at` overrides where it plays from (a note left on an older version, found in this one
 * through the footage; null when that part was cut). Waiting notes can be removed; fixed ones resolved or sent back; resolved ones reopened.
 */
function NoteRow({ n, seek, at, origin, here, active, anchor }: { n: any; seek: (at: number) => void; at?: number | null; origin?: string; here?: string; active?: boolean; anchor?: boolean }) {
  const [err, setErr] = useState("");
  const st = noteState(n);
  const t = at === undefined ? n.at : at;
  const short = n.text.length > 40 ? n.text.slice(0, 39) + "…" : n.text;
  const go = (what: "resolve" | "reopen") => { setErr(""); api.post(`/api/notes/${n.id}/${what}`).catch((e) => setErr((e as Error).message)); };
  return (
    <div class={"note st-" + st.key + (active ? " active" : "")} id={anchor ? `note-${n.id}` : undefined} aria-current={active ? "true" : undefined}>
      {t === null
        ? <span class="mono note-gone" title={`That part is not in ${here}`}>gone</span>
        : <button class="mono" data-seek onClick={() => seek(t)} aria-label={`Play from ${tc(t)}: ${short}`}>{tc(t)}</button>}
      <div class="note-body">
        <span>{n.text}</span>
        <span class="note-meta">
          <span class={"pill " + (st.tone === "plain" ? "face" : st.tone)}>{st.label}</span>
          {origin && <span class="faint small">{t === null ? `Left on ${origin} at ${tc(n.at)}; that part is not in ${here}.` : `Left on ${origin} at ${tc(n.at)}.`}</span>}
        </span>
        {n.reply && <span class="reply">Agent: {n.reply}</span>}
        {err && <span class="err">{err}</span>}
      </div>
      <div class="note-acts">
        {st.key === "waiting" && <button onClick={() => api.del(`/api/notes/${n.id}`)} aria-label={`Remove: ${short}`}>Remove</button>}
        {st.key === "check" && <><button class="resolve" onClick={() => go("resolve")} aria-label={`Resolve: ${short}`}>Resolve</button><button onClick={() => go("reopen")} aria-label={`Not fixed, send it back: ${short}`}>Not fixed</button></>}
        {st.key === "resolved" && <button onClick={() => go("reopen")} aria-label={`Reopen: ${short}`}>Reopen</button>}
      </div>
    </div>
  );
}

/* ---------------- Joins ---------------- */

interface Join { n: number; at: number; flags: string[]; outOf: string; into: string; heard: { before: string; after: string } | null; sheet: string | null }

function Joins({ project, version, joins, jump, note, open }: {
  project: string; version: string; joins: { items: Join[]; listened: boolean; stale: boolean } | null;
  jump: (at: number) => void; note?: (j: Join) => void; open: (s: { src: string; title: string }) => void;
}) {
  const [all, setAll] = useState(false);
  if (!joins) {
    return (
      <div class="pad joins">
        <h3>Joins</h3>
        <p class="muted small">Not listened to yet. <span class="mono">yap-machine check {version}</span> re-listens to the render at every cut and draws a picture of each one.</p>
      </div>
    );
  }
  const flagged = joins.items.filter((j) => j.flags.length);
  const rest = joins.items.filter((j) => !j.flags.length);
  const row = (j: Join) => {
    const src = j.sheet ? media(project, j.sheet) : null;
    return (
      <div class={"join" + (j.flags.length ? " flagged" : "")}>
        <button class="mono at" title="Play from a second before the cut" data-seek onClick={() => jump(j.at)}>{tc(j.at)}</button>
        <div class="join-body">
          <div class="join-text"><span class="faint">…{j.outOf}</span><i aria-hidden="true" /><span>{j.into}…</span></div>
          {j.flags.map((f) => <p class="join-flag"><span class="pill warn">look</span>{f}</p>)}
          {j.heard && j.flags.length > 0 && <p class="faint small">Heard: …{j.heard.before} │ {j.heard.after}…</p>}
          {src && (j.flags.length > 0 || all) && (
            <button class="sheet" aria-label={`Open the picture of join ${j.n} larger`} onClick={() => open({ src, title: `${version} · join ${j.n} · ${tc(j.at)}` })}>
              <img src={src} alt={`Join ${j.n}: frames across the cut, the waveform, and the words meant against the words heard`} loading="lazy" />
            </button>
          )}
          <div class="row" style="gap:6px">
            {src && <button class="btn small" onClick={() => open({ src, title: `${version} · join ${j.n} · ${tc(j.at)}` })}>View larger</button>}
            {j.flags.length > 0 && note && <button class="btn small" onClick={() => note(j)}>Note this</button>}
          </div>
        </div>
      </div>
    );
  };
  return (
    <div class="joins">
      <div class="pad" style="padding-bottom:6px">
        <div class="row between"><h3>Joins</h3>
          <span class="pill face">{flagged.length} flagged of {joins.items.length}</span></div>
        <p class="muted small">
          {joins.listened ? "The render was re-listened to at every cut: are the words either side still whole, is anything heard twice, does the room sound carry across." : "Room sound was checked at every cut; the render wasn't re-transcribed."}
          {" "}A flag means look, not wrong: the listening can mishear.
        </p>
        {joins.stale && <p class="small"><span class="pill warn" style="margin-right:6px">older</span>This version was cut again after these joins were checked, so they may not line up. Your agent re-checks with <span class="mono">yap-machine check {version}</span>.</p>}
      </div>
      {flagged.map(row)}
      {rest.length > 0 && (
        <div class="pad" style="padding-top:8px">
          <button class="btn small" aria-expanded={all} onClick={() => setAll(!all)}>{all ? "Hide" : "Show"} {rest.length} join{rest.length === 1 ? "" : "s"} with nothing flagged</button>
        </div>
      )}
      {all && rest.map(row)}
    </div>
  );
}

function Lightbox({ src, title, onClose }: { src: string; title: string; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
    const on = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  }, []);
  return (
    <div class="lightbox" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div class="lightbox-card" onClick={(e) => e.stopPropagation()}>
        <div class="row between"><span class="mono small">{title}</span><button ref={close} class="btn small" onClick={onClose}>Close</button></div>
        <img src={src} alt={title} />
        <p class="fine">Six frames across the cut (the red ones are either side of it), the waveform with the cut in red, then the words the cut meant against the words heard in the render.</p>
      </div>
    </div>
  );
}

/* ---------------- Shorts ---------------- */

function Shorts({ project, desk, waitingCount }: { project: any; desk: any; waitingCount: number }) {
  const [lang, setLang] = useState<Record<string, string>>({});
  const [sheet, setSheet] = useState<{ src: string; title: string } | null>(null);
  const [err, setErr] = useState("");
  if (!project.shorts.length) return <section class="view"><div class="empty"><h2>No shorts yet</h2><p>Once you're happy with a long version, ask your agent: "cut shorts from v2".</p></div></section>;
  return (
    <section class="view">
      <div class="view-head"><div><span class="label">Shorts · {project.name}</span><h1>{project.shorts.length} short{project.shorts.length > 1 ? "s" : ""}, one point each</h1>
        <p class="muted">Cut from a long version you approved and reframed to 9:16 around your face. Fixes to the long version carry through. Notes you add are pinned to the moment you're watching and wait until you send them.</p></div>
        <button class="btn primary" disabled={!waitingCount} onClick={() => api.post(`/api/projects/${project.id}/send`, {}).catch((e) => setErr(e.message))}>Send to agent <span class={"count" + (waitingCount ? "" : " zero")}>{waitingCount}</span></button>
      </div>
      {err && <p class="err">{err}</p>}
      <div class="shorts">
        {project.shorts.map((s: any) => <ShortCard project={project} s={s} notes={desk.notes.filter((n: any) => n.project === project.id && n.version === s.version)} l={lang[s.version] ?? "en"} setLang={(x) => setLang({ ...lang, [s.version]: x })} open={setSheet} />)}
      </div>
      {sheet && <Lightbox src={sheet.src} title={sheet.title} onClose={() => setSheet(null)} />}
    </section>
  );
}

function ShortCard({ project, s, notes, l, setLang, open }: { project: any; s: any; notes: any[]; l: string; setLang: (l: string) => void; open: (s: { src: string; title: string }) => void }) {
  const vid = useRef<HTMLVideoElement>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [data, setData] = useState<any>(null);
  const [t, setT] = useState(0);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const src = l === "en" ? s.render : `renders/${s.version}.${l}.mp4`;
  // the version's data (joins, frame rate, render revision) is read once for the timeline, and again whenever the engine rewrites it
  useEffect(() => {
    api.get(`/api/projects/${project.id}/versions/${s.version}`).then(setData).catch(() => setData(null));
  }, [s.version, s.modified]);
  const j = s.joins as { flagged: number; total: number; stale: boolean } | null;
  // the same status as everywhere else: the check and the join report counted together
  const status = versionStatus(s);
  const generalWarnings = s.check ? s.check.warnings.filter((x: string) => !isJoinWarning(x)) : [];
  const markers = useMemo(() => markersFor(notes, data?.joins && !data.joins.stale ? data.joins.items : []), [notes, data]);
  const goTo = (at: number) => { const el = vid.current; if (!el) return; const x = Math.min(Math.max(0, at), s.duration); el.currentTime = x; setT(x); };
  const seek = (at: number) => { if (vid.current) { vid.current.currentTime = at; vid.current.play().catch(() => undefined); } };
  const act = (a: KeyAction): boolean => {
    const el = vid.current; if (!el) return false;
    if (a.type === "step") { el.pause(); goTo(stepFrames(el.currentTime, data?.fps ?? 25, a.frames, s.duration)); return true; }
    if (a.type === "nudge") { goTo(el.currentTime + a.seconds); return true; }
    if (a.type === "home") { goTo(0); return true; }
    if (a.type === "end") { goTo(s.duration); return true; }
    return false;
  };
  // a note is pinned to this short at the moment being watched (or, from a join, at the join)
  const add = async (txt = text, at?: number) => {
    setErr("");
    if (!txt.trim()) { setErr("Type a note first."); return; }
    try { await api.post("/api/notes", { project: project.id, version: s.version, at: at ?? vid.current?.currentTime ?? t, text: txt }); setText(""); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div class="panel short">
      {src ? <video ref={vid} onTimeUpdate={(e) => setT((e.target as HTMLVideoElement).currentTime)} onSeeked={(e) => setT((e.target as HTMLVideoElement).currentTime)} controls playsInline preload="none" key={src} src={media(project.id, src)} poster={`/poster/${encodeURIComponent(project.id)}/${src.split("/")[1]}?t=3`} /> : <div class="empty">Not rendered yet</div>}
      {src && <Timeline compact project={project.id} version={s.version} rev={data ? data.renderRev : undefined} dur={s.duration || 1} fps={data?.fps ?? null} video={vid} markers={markers} seek={goTo} act={act} />}
      <div class="row between"><h3>{s.version}</h3><span class="mono faint small">{tc(s.duration)}</span></div>
      {s.brief && <p class="muted small">{s.brief.replace(/^Short:\s*/i, "")}</p>}
      <div class="seg-ctl" role="group" aria-label="Caption language">
        {["en", ...s.languages].map((x: string) => <button aria-pressed={l === x} onClick={() => setLang(x)}>{({ en: "English", es: "Spanish", fr: "French", de: "German", pt: "Portuguese", it: "Italian" } as any)[x] ?? x}</button>)}
      </div>
      <div class="row" style="gap:6px;flex-wrap:wrap">
        <StatusPill status={status} expanded={showDetails} onClick={() => setShowDetails(!showDetails)} />
        {j && src && <button class="btn small ghost" aria-expanded={showDetails} title="Every cut was re-listened to in the render" onClick={() => setShowDetails(!showDetails)}>{j.total} join{j.total === 1 ? "" : "s"}{j.stale ? " (older)" : ""} {showDetails ? "▴" : "▾"}</button>}
        {!j && s.render && <span class="faint small">Joins not listened to yet</span>}
      </div>
      {showDetails && (
        <div class="short-joins">
          {s.check && (s.check.errors.length > 0 || generalWarnings.length > 0) && (
            <div class="pad" style="padding-bottom:6px">
              {[...s.check.errors.map((x: string) => ["rec", x]), ...generalWarnings.map((x: string) => ["warn", x])].map(([k, x]) => <p class="small"><span class={"pill " + k} style="margin-right:6px">{k === "rec" ? "fix" : "look"}</span>{x}</p>)}
            </div>
          )}
          {data ? <Joins project={project.id} version={s.version} joins={data.joins ?? null} jump={(at) => seek(Math.max(0, at - 1))} open={open}
            note={(j) => add(`Check the join here: ${j.flags[0] ?? "listen to it"}`, j.at)} />
            : <p class="faint small pad">Loading…</p>}
        </div>
      )}
      <div class="short-note">
        <label class="mono small" for={`note-${s.version}`} style="color:var(--rec-ink)">Note at {tc(t)}</label>
        <div class="row" style="gap:6px;flex-wrap:nowrap">
          <input id={`note-${s.version}`} placeholder="Tighten this, cut this line…" value={text} onFocus={() => vid.current?.pause()}
            onInput={(e) => setText((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
          <button class="btn small" onClick={() => add()}>Add note</button>
        </div>
        {err && <p class="err" style="margin:0">{err}</p>}
        {notes.map((n) => <NoteRow n={n} seek={seek} />)}
      </div>
    </div>
  );
}

/* ---------------- Look ---------------- */

const ACCENTS = ["#F0412B", "#2B69F6", "#14938E", "#E8A317", "#0B0B0D"];

function Look({ project, desk, refreshDesk, initialVersion, onVersion }: { project: any; desk: any; refreshDesk: () => Promise<void>; initialVersion?: string; onVersion: (v: string) => void }) {
  const [look, setLook] = useState<any>(null);
  const [spell, setSpell] = useState("");
  const [err, setErr] = useState("");
  const [captionRequests, setCaptionRequests] = useState(0);
  const [sending, setSending] = useState(false);
  const pending = desk.look.filter((c: any) => c.project === project.id);
  const captionEdits = captionEditState(desk, project.id, captionRequests > 0 || sending);
  const batchRevision = desk.batches.filter((b: any) => b.project === project.id).map((b: any) => `${b.id}:${b.status}`).join('|');
  const val = (key: string, fallback: any) => pending.find((c: any) => c.key === key)?.value ?? fallback;
  useEffect(() => { api.get(`/api/projects/${project.id}/look`).then(setLook).catch(e => setErr(e.message)); }, [project.id, batchRevision]);
  const short = project.shorts[0];
  if (!look) return <section class="view"><p class="faint">{err || "Loading…"}</p></section>;
  const change = async (key: string, value: unknown, label: string) => {
    setCaptionRequests(n => n + 1); setErr('');
    try { await api.post(`/api/projects/${project.id}/look`, { key, value, label }); await refreshDesk(); }
    catch (e) { setErr((e as Error).message); }
    finally { setCaptionRequests(n => n - 1); }
  };
  const sendChanges = async () => {
    setSending(true); setErr('');
    try { await api.post(`/api/projects/${project.id}/send`, {}); await refreshDesk(); }
    catch (e) { setErr((e as Error).message); }
    finally { setSending(false); }
  };
  const accent = val("accent", look.accent);
  const person = look.people[0] ?? { id: "me", name: "", title: "" };
  const name = val(`person.${person.id}.name`, person.name);
  const title = val(`person.${person.id}.title`, person.title);
  const capStyle = val("captions.short", look.captions.short ?? {});
  const upper = capStyle.case === "upper";
  return (
    <section class="look-view">
      <VisualStudio key={project.id} project={project} initialVersion={initialVersion} onVersion={onVersion} captionEdits={captionEdits} captions={<div class="vs-caption-controls">
      {err && <p class="err" role="alert">{err}</p>}
      {pending.length > 0 && <div class="vs-input-hint"><p>{pending.length} change{pending.length === 1 ? '' : 's'} ready for your agent.</p><button class="btn" disabled={sending || captionRequests > 0} onClick={sendChanges}>{sending ? 'Sending changes…' : 'Send changes to agent'}</button></div>}
        <div class="stack" style="gap:16px">
          <div class="panel pad">
            <h3>Captions</h3>
            <div class="row"><span class="faint small" style="width:80px">Shorts</span>
              <div class="seg-ctl" role="group" aria-label="Short captions">
                <button aria-pressed={!upper} onClick={() => change("captions.short", { ...capStyle, case: "none" }, "Short captions: sentence case")}>Bold, 2–3 words</button>
                <button aria-pressed={upper} onClick={() => change("captions.short", { ...capStyle, case: "upper" }, "Short captions: capitals")}>Bold capitals</button>
              </div></div>
            <div class="row"><span class="faint small" style="width:80px">Long form</span><span class="chip">Sentence captions, up to 2 lines</span></div>
            <div class="field"><label>Highlight colour</label>
              <div class="swatches">
                {ACCENTS.map((c) => <button class="swatch" style={{ background: c }} aria-pressed={accent.toLowerCase() === c.toLowerCase()} aria-label={`Highlight ${c}`} onClick={() => change("accent", c, `Highlight colour ${c}`)} />)}
                <input type="color" aria-label="Any colour" value={accent} onChange={(e) => { const c = (e.target as HTMLInputElement).value.toUpperCase(); change("accent", c, `Highlight colour ${c}`); }} style="width:34px;height:28px;border:0;background:none;padding:0" />
              </div></div>
          </div>
          <div class="panel pad">
            <h3>Name card</h3>
            <div class="grid2">
              <div class="field"><label for="pname">Name</label><input id="pname" value={name} onChange={(e) => change(`person.${person.id}.name`, (e.target as HTMLInputElement).value, `Name card: ${(e.target as HTMLInputElement).value}`)} /></div>
              <div class="field"><label for="ptitle">Title</label><input id="ptitle" value={title} onChange={(e) => change(`person.${person.id}.title`, (e.target as HTMLInputElement).value, `Name card title: ${(e.target as HTMLInputElement).value}`)} /></div>
            </div>
          </div>
          <div class="panel pad">
            <h3>Spellings</h3>
            <p class="muted small">Names the transcription gets wrong. Fixed in captions, and used as a hint next time.</p>
            <div class="chips">{Object.entries(look.spellings).map(([a, b]) => <span class="chip"><span class="mono faint">{a}</span>→<b style="font-weight:600">{String(b)}</b></span>)}
              {pending.filter((c: any) => c.key.startsWith("spelling")).map((c: any) => <span class="chip"><span class="mono faint">{c.value[0]}</span>→<b style="font-weight:600">{c.value[1]}</b><span class="faint">(waiting)</span></span>)}</div>
            <div class="row"><div class="field" style="flex:1;min-width:160px"><input id="spell" placeholder="e.g. icp → ICP" aria-label="Add a spelling" value={spell} onInput={(e) => setSpell((e.target as HTMLInputElement).value)} /></div>
              <button class="btn small" onClick={() => {
                const m = spell.split(/→|->/).map((s) => s.trim());
                if (m.length !== 2 || !m[0] || !m[1]) { setErr("Write a spelling as: wrong → right"); return; }
                change(`spelling.${m[0].toLowerCase()}`, [m[0], m[1]], `Spelling: ${m[0]} → ${m[1]}`); setSpell(""); setErr("");
              }}>Add</button></div>
          </div>
          <div class="panel pad">
            <h3>Languages</h3>
            <div class="chips"><span class="chip">English</span>{[...new Set(project.shorts.flatMap((s: any) => s.languages))].map((l) => <span class="chip">{String(l)}</span>)}</div>
            <p class="muted small">Ask your agent in the chat, e.g. "Spanish captions on all the shorts". It translates sentence by sentence; nothing goes to a translation service.</p>
          </div>
        </div>
      </div>
      }/>
    </section>
  );
}

/* ---------------- Chat ---------------- */

function Chat({ project, desk, busy, waitingAgent }: { project: any; desk: any; busy: boolean; waitingAgent: boolean }) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<{ path: string; name: string }[]>([]);
  const [err, setErr] = useState("");
  const [sending, setSending] = useState(false);
  const thread = useRef<HTMLDivElement>(null);
  const msgs = useMemo(() => desk.messages.filter((m: any) => !project || !m.project || m.project === project.id), [desk.messages, project?.id]);
  useEffect(() => { thread.current?.scrollTo({ top: 1e9 }); }, [msgs.length, busy]);
  const upload = async (list: FileList | null) => {
    if (!list) return;
    for (const f of Array.from(list)) {
      const fd = new FormData(); fd.append("file", f); if (project) fd.append("project", project.id);
      try { const r = await api.post("/api/upload", fd); setFiles((x) => [...x, { path: r.path, name: r.name }]); } catch (e) { setErr((e as Error).message); }
    }
  };
  const send = async () => {
    setErr("");
    if (!text.trim() && !files.length) { setErr("Write a message or attach a file first."); return; }
    setSending(true);
    try { await api.post("/api/chat", { project: project?.id, text, files: files.map((f) => f.path) }); setText(""); setFiles([]); } catch (e) { setErr((e as Error).message); }
    setSending(false);
  };
  return (
    <aside class="chat" aria-label="Agent chat">
      <div class="chat-head"><span class={"recdot" + (busy ? " live" : "")} aria-hidden="true" style="width:8px;height:8px" /><b>Your agent</b>{project && <span class="faint small">· {project.name}</span>}</div>
      <div class="thread" ref={thread}>
        {!msgs.length && <p class="fine" style="text-align:center;margin-top:20px">Messages, notes and files you send go to your agent. Its replies appear here.</p>}
        {msgs.map((m: any) => (
          <div class={"msg " + m.from}>
            <div class="who">{m.from === "you" ? "You" : "Agent"} · {new Date(m.created).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
            {m.text}
            {m.files?.length > 0 && <div>{m.files.map((f: string) => <span class="att">File: {f.split("/").pop()}</span>)}</div>}
          </div>
        ))}
        {busy && <div class="status-line"><span class="recdot live" style="width:7px;height:7px" />Your agent picked it up and is working</div>}
        {!busy && waitingAgent && <div class="status-line">Sent. Your agent picks it up next time it checks in.</div>}
      </div>
      <div class="chat-in">
        {files.length > 0 && <div class="chips">{files.map((f) => <span class="chip">File: {f.name}<button class="btn ghost small" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((x) => x !== f))}>×</button></span>)}</div>}
        <label for="chatText" class="label">Message your agent</label>
        <textarea id="chatText" rows={2} placeholder="Ask for a change, or attach B-roll" value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); }}
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer?.files ?? null); }} />
        {err && <p class="err">{err}</p>}
        <div class="row between">
          <label class="btn small" for="fileIn">Attach file</label>
          <input id="fileIn" type="file" multiple hidden onChange={(e) => { upload((e.target as HTMLInputElement).files); (e.target as HTMLInputElement).value = ""; }} />
          <button class="btn primary small" disabled={sending} onClick={send}>Send</button>
        </div>
        <p class="fine">Goes to your agent through Yap Machine on this computer, along with any notes waiting.</p>
      </div>
    </aside>
  );
}
