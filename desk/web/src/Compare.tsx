import { tc } from "./api.js";
import { clock } from "./timeline-math.js";
import { overlaps, spanOf, type View } from "./timeline-zoom.js";
import { noteState } from "./status.js";
import { SMALL_CHANGE, changeCount, noteNow, type CutDiff, type CutSeg, type Piece } from "./cut-diff.js";

const length = (n: number) => (n < 10 ? `${n.toFixed(1)} s` : `${Math.round(n)} s`);
const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const clip = (s: string, n = 150) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/**
 * Two thin strips under the video, lined up with the timeline below them: what the older version has that the newer doesn't (red),
 * and what the newer one added (green). Zoom the timeline and both follow it: the newer row by its own times, the older row by the
 * stretch of the older cut that has the same words. Click a piece to go there.
 */
export function DiffStrip(p: { a: string; b: string; durA: number; durB: number; diff: CutDiff; viewA: View; viewB: View; onSeekA(t: number): void; onSeekB(t: number): void }) {
  const row = (name: string, view: View, pieces: Piece[], kind: "added" | "removed", seek: (t: number) => void) => {
    const span = spanOf(view);
    return (
      <div class="ds-track" role="group" aria-label={name}>
        {pieces.filter((q) => overlaps(view, q.from, q.to)).map((q) => {
          const small = q.to - q.from < SMALL_CHANGE;
          const what = `${kind === "added" ? `Added in ${p.b}` : `Cut from ${p.a}`}, ${clock(q.from)}, ${small ? "a small trim" : length(q.to - q.from)}: ${clip(q.text, 80)}`;
          const from = Math.max(q.from, view.start), to = Math.min(q.to, view.end);
          return <button class={"ds-piece " + kind + (small ? " small" : "")} style={{ ["--x" as any]: String(((from - view.start) / span) * 100), ["--w" as any]: String(((to - from) / span) * 100) }} aria-label={what} title={what} data-seek onClick={() => seek(q.from)}><i aria-hidden="true" /></button>;
        })}
      </div>
    );
  };
  const d = p.diff;
  return (
    <div class="ds" role="group" aria-label={`What changed between ${p.a} and ${p.b}`}>
      {row(`Cut from ${p.a}`, p.viewA, [...d.removed, ...d.trimsRemoved], "removed", p.onSeekA)}
      {row(`Added in ${p.b}`, p.viewB, [...d.added, ...d.trimsAdded], "added", p.onSeekB)}
      <div class="ds-key" aria-hidden="true"><span><i class="lg lg-cut" />Cut from {p.a}</span><span><i class="lg lg-add" />Added in {p.b}</span></div>
    </div>
  );
}

interface Note { id: string; at: number; text: string; status: string; fixedIn?: string; reply?: string; reopened?: number }

/** The side panel in Compare: what changed, and where the older version's notes went. */
export function ComparePanel(p: {
  a: string; b: string; diff: CutDiff | null; segsA: CutSeg[]; segsB: CutSeg[]; durA: number; durB: number;
  notesA: Note[]; notesB: Note[]; onSeekA(t: number): void; onSeekB(t: number): void; onClose(): void;
}) {
  const d = p.diff;
  const delta = p.durB - p.durA;
  const piece = (q: Piece, kind: "added" | "removed") => (
    <button class={"chg " + kind} data-seek onClick={() => (kind === "added" ? p.onSeekB(q.from) : p.onSeekA(q.from))}>
      <span class="mono">{tc(q.from)}</span>
      <span><span class="meta"><span class={"pill " + (kind === "added" ? "ok" : "rec")}>{kind === "added" ? `added to ${p.b}` : `cut from ${p.a}`}</span><span class="faint small">{length(q.to - q.from)}{q.partial ? ", part of a line" : ""}</span></span><span>{clip(q.text)}</span></span>
    </button>
  );
  return (
    <div class="cmp-panel">
      <div class="pad" style="padding-bottom:6px">
        <div class="row between"><h3>Changes from {p.a} to {p.b}</h3><button class="btn small" onClick={p.onClose}>Close compare</button></div>
        {!d ? <p class="faint">Reading both versions…</p> : (
          <p class="muted small">
            {p.b} is {tc(p.durB)} ({delta >= 0 ? "+" : "−"}{Math.abs(delta).toFixed(1)} s against {p.a}).{" "}
            {changeCount(d) ? `${d.added.length} added and ${d.removed.length} cut: ${length(d.addedSeconds)} in, ${length(d.removedSeconds)} out in all.` : "No lines were added or cut."}
            {d.trimsAdded.length + d.trimsRemoved.length > 0 && ` ${plural(d.trimsAdded.length + d.trimsRemoved.length, "small trim")} of a cut edge.`}
          </p>
        )}
        <p class="fine">The two videos play together, kept on the same words. Where {p.b} has something {p.a} doesn't, {p.a} waits.</p>
      </div>
      {d && d.added.length > 0 && <div class="chg-group"><h3 class="grp">Added in {p.b} ({d.added.length})</h3>{d.added.map((q) => piece(q, "added"))}</div>}
      {d && d.removed.length > 0 && <div class="chg-group"><h3 class="grp">Cut from {p.a} ({d.removed.length})</h3>{d.removed.map((q) => piece(q, "removed"))}</div>}
      {d && d.trimsAdded.length + d.trimsRemoved.length > 0 && (
        <details class="pad trims">
          <summary class="small">{plural(d.trimsAdded.length + d.trimsRemoved.length, "small trim")} of a cut edge</summary>
          <div class="stack" style="gap:6px;margin-top:8px">
            {[...d.trimsAdded.map((q) => ["added", q] as const), ...d.trimsRemoved.map((q) => ["removed", q] as const)].sort((x, y) => x[1].srcFrom - y[1].srcFrom).map(([k, q]) => (
              <p class="small"><span class="mono">{tc(q.from)}</span> <span class={"pill " + (k === "added" ? "ok" : "rec")}>{k === "added" ? "now has" : "no longer has"}</span> {length(q.to - q.from)} {k === "added" ? `more in ${p.b}` : `from ${p.a}`}: <span class="muted">{clip(q.text, 70)}</span></p>
            ))}
          </div>
        </details>
      )}
      <div class="chg-group">
        <h3 class="grp">Notes on {p.a} ({p.notesA.length})</h3>
        {!p.notesA.length && <p class="muted small pad" style="padding-top:0">No notes were left on {p.a}.</p>}
        {p.notesA.map((n) => {
          const now = noteNow(p.segsA, p.segsB, n.at);
          return (
            <div class="chg-note">
              <button class="mono" data-seek onClick={() => p.onSeekA(n.at)}>{tc(n.at)}</button>
              <div><span>{n.text}</span>
                <p class="small faint">
                  {noteState(n).label}.{" "}
                  {"cut" in now ? `That part is not in ${p.b}.` : <>In {p.b} it is at <button class="linkbtn" data-seek onClick={() => p.onSeekB((now as { at: number }).at)}>{tc((now as { at: number }).at)}</button>.</>}
                </p>
                {n.reply && <p class="small muted">Agent: {n.reply}</p>}
              </div>
            </div>
          );
        })}
      </div>
      {p.notesB.length > 0 && (
        <div class="chg-group">
          <h3 class="grp">Notes on {p.b} ({p.notesB.length})</h3>
          {p.notesB.map((n) => <div class="chg-note"><button class="mono" data-seek onClick={() => p.onSeekB(n.at)}>{tc(n.at)}</button><div><span>{n.text}</span></div></div>)}
        </div>
      )}
    </div>
  );
}
