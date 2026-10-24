import { useEffect, useId, useMemo, useRef, useState } from "preact/hooks";
import type { Marker, KeyAction } from "./timeline-math.js";
import { clock, hasRange, quietRuns, rangeLabel, setEdge, type LoopRange } from "./timeline-math.js";
import { cachedTile, loadPeaks, loadTile, tileKey, type WaveState } from "./peaks.js";
import { noteState, type NoteKey } from "./status.js";
import {
  clampView, edgeSpeed, follow, framePx, fullView, isFull, keyZoom, minSpan, overlaps, panBy, pickLevel, pinch, rulerTicksIn, showFrameTicks, spanOf, tileMax, tileSeconds, tilesFor,
  timeOf, visible, wheelFactor, xOf, zoomAt, zoomLabel, type View,
} from "./timeline-zoom.js";
import { Minimap } from "./Minimap.js";
import { hit } from "./focus.js";

export interface TimelineProps {
  project: string;
  version: string;
  /** The render's size and modified time: the waveform is remembered per revision. Null when nothing is rendered, undefined while that is still being read. */
  rev: string | null | undefined;
  dur: number;
  fps: number | null;
  video: { current: HTMLVideoElement | null };
  segments?: { t: number; e: number; beat: string; layout: string }[];
  markers: Marker[];
  /** Move the playhead without changing whether it's playing. */
  seek: (t: number) => void;
  /** Step, nudge, Home, End from the slider's own keys. */
  act: (a: KeyAction) => void;
  compact?: boolean;
  /** The loop range (set with In and Out) and whether looping is on. Absent on the short cards. */
  range?: LoopRange;
  loopOn?: boolean;
  onRange?: (r: LoopRange) => void;
  /** The control bar shows its own time elsewhere. */
  hideTime?: boolean;
  /** Keep the overview ruler to whole seconds; detailed timelines retain subsecond labels by default. */
  wholeSecondTicks?: boolean;
  /** The stretch on screen. Leave both out and the timeline keeps its own; the Review screen holds it so the compare strip can follow. */
  view?: View;
  onView?: (v: View) => void;
}

const PITCH = 3;   // css px between waveform bars
const BAR = 2;     // css px width of a bar
/** After the person moves the window by hand, playback leaves it alone for this long. */
const HOLD_MS = 2500;

function useWave(project: string, version: string, rev: string | null | undefined): WaveState {
  const [state, setState] = useState<WaveState>({ kind: "loading" });
  useEffect(() => {
    if (rev === undefined) { setState({ kind: "loading" }); return; }
    if (rev === null) { setState({ kind: "unrendered" }); return; }
    setState({ kind: "loading" });
    const ctl = new AbortController();
    loadPeaks(project, version, rev, ctl.signal).then(setState).catch(() => undefined);
    return () => ctl.abort();
  }, [project, version, rev]);
  return state;
}

const NOTE_LEGEND: Record<NoteKey, string> = { waiting: "Note, waiting", sent: "With your agent", check: "Fixed, to check", resolved: "Resolved" };

/** A pointer that isn't really down (a test's, or one that has just lifted) can't be captured; that is no reason to stop. */
const capture = (e: PointerEvent) => { try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* not an active pointer */ } };

const release = (e: PointerEvent) => { try { (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId); } catch { /* it had already let go */ } };

const Svg = ({ children }: { children: preact.ComponentChildren }) => <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">{children}</svg>;
const PlusIcon = () => <Svg><path d="M9 3.5v11M3.5 9h11" /></Svg>;
const MinusIcon = () => <Svg><path d="M3.5 9h11" /></Svg>;
const FitIcon = () => <Svg><path d="M2.5 9h4M11.5 9h4M5 6.5 2.5 9 5 11.5M13 6.5 15.5 9 13 11.5" /></Svg>;

export function Timeline(p: TimelineProps) {
  const { dur, compact } = p;
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLCanvasElement>(null);
  const played = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(800);
  const [now, setNow] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
  const [tileTick, setTileTick] = useState(0);
  const [ownView, setOwnView] = useState<View>(() => fullView(dur));
  const resume = useRef(false);
  const edgeDrag = useRef<"in" | "out" | null>(null);
  const wave = useWave(p.project, p.version, p.rev);
  const peaks = wave.kind === "wave" ? wave.wave : null;
  const quiet = useMemo(() => (peaks ? quietRuns(peaks.peaks, peaks.duration) : []), [peaks]);

  const view = useMemo(() => clampView(p.view ?? ownView, dur), [p.view, ownView, dur]);
  const span = spanOf(view);
  const zoomed = !isFull(view, dur);
  // the pieces that run outside React's render (wheel, pinch, the frame loop) read these
  const live = useRef<{ view: View; dur: number; width: number; p: TimelineProps; pm: (clientX: number) => void }>(null as never);
  live.current = { view, dur, width, p, pm: live.current?.pm ?? (() => undefined) };
  const hold = useRef(0);
  const manual = () => { hold.current = performance.now() + HOLD_MS; };
  const setView = (v: View) => {
    const c = clampView(v, live.current.dur);
    live.current.view = c;
    if (live.current.p.onView) live.current.p.onView(c); else setOwnView(c);
  };
  // a new cut starts on the whole of it (the Review screen does the same for the one it holds)
  useEffect(() => { if (!p.onView) setOwnView(fullView(dur)); }, [dur, p.version]);

  useEffect(() => {
    const el = surface.current; if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(120, el.clientWidth)));
    ro.observe(el); setWidth(Math.max(120, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  // Scrubbing near an edge of a zoomed timeline keeps panning until the pointer comes back
  const scrub = useRef<{ x: number } | null>(null);
  // The playhead reads the video every frame, so it is smooth while playing and follows any seek, whoever made it.
  // The window follows the playhead: it turns the page while playing, and finds the playhead after a jump.
  useEffect(() => {
    let raf = 0, last = -1, lastFrame = performance.now();
    const tick = (stamp: number) => {
      const L = live.current;
      const v = L.p.video.current;
      const t = v?.currentTime ?? 0;
      const moved = Math.abs(t - last) > 0.004;
      const jump = last >= 0 && Math.abs(t - last) > 0.35;
      if (moved) setNow(t);
      const s = scrub.current;
      const dt = Math.min(0.1, (stamp - lastFrame) / 1000);
      lastFrame = stamp;
      if (s && surface.current && !isFull(L.view, L.dur)) {
        const r = surface.current.getBoundingClientRect();
        const speed = edgeSpeed(s.x - r.left, r.width, spanOf(L.view));
        if (speed) { manual(); setView(panBy(L.view, speed * dt, L.dur)); L.pm(s.x); }
      } else if (moved && !s && v) {
        const playing = !v.paused;
        if (!playing || jump || performance.now() > hold.current) {
          const next = follow(L.view, t, L.dur, { playing });
          if (next !== L.view) setView(next);
        }
      }
      if (moved) last = t;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const wh = compact ? 40 : 56;
  const bars = Math.max(1, Math.floor(width / PITCH));
  const overviewRate = peaks ? peaks.peaks.length / Math.max(1e-6, peaks.duration) : 0;
  const level = peaks ? pickLevel(span, bars, overviewRate) : null;

  // finer waveform for the stretch on screen, and a little either side so panning doesn't catch it out
  const tileRange = level === null ? "" : (() => { const t = tilesFor(level, view, dur, 0.75); return `${level}:${t[0]}-${t[t.length - 1]}`; })();
  useEffect(() => {
    if (level === null || !p.rev) return;
    const ctl = new AbortController();
    const near = tilesFor(level, view, dur, 0), around = tilesFor(level, view, dur, 0.75);
    for (const i of [...near, ...around.filter((x) => !near.includes(x))]) {
      loadTile(p.project, p.version, p.rev, level, i, ctl.signal).then(() => { if (!ctl.signal.aborted) setTileTick((n) => n + 1); });
    }
    return () => ctl.abort();
  }, [tileRange, p.project, p.version, p.rev]);

  useEffect(() => {
    if (!peaks || !base.current || !played.current) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const css = getComputedStyle(document.documentElement);
    const col = (n: string) => css.getPropertyValue(n).trim() || "#888";
    const palette: [HTMLCanvasElement, string, string][] = [
      [base.current, col("--wave"), col("--wave-quiet")],
      [played.current, col("--wave-played"), col("--wave-played-quiet")],
    ];
    // bars sit on a grid fixed to the cut, not to the window, so panning slides them instead of shimmering
    const barDur = span / bars;
    const first = Math.floor(view.start / barDur);
    const n = peaks.peaks.length;
    const tiles = level === null || !p.rev ? null : { get: (i: number) => cachedTile(tileKey(p.project, p.version, p.rev!, level, i)) ?? undefined };
    const runs = quiet.filter((r) => overlaps(view, r.from, r.to));
    const hs: number[] = [], xs: number[] = [], flags: number[] = [];
    for (let k = 0; k < bars + 2; k++) {
      const t0 = (first + k) * barDur, t1 = t0 + barDur;
      if (t1 <= 0 || t0 >= dur) continue;
      const x = ((t0 - view.start) / span) * width;
      if (x + BAR < 0 || x > width) continue;
      let pk = tiles && level !== null ? tileMax(level, tiles, Math.max(0, t0), Math.min(dur, t1)) : null;
      if (pk === null) {
        if (t0 >= peaks.duration) pk = 0;
        else {
          const a = Math.min(n - 1, Math.floor((Math.max(0, t0) / peaks.duration) * n));
          const b = Math.min(n, Math.max(a + 1, Math.ceil((Math.min(t1, peaks.duration) / peaks.duration) * n)));
          pk = 0;
          for (let i = a; i < b; i++) if (peaks.peaks[i] > pk) pk = peaks.peaks[i];
        }
      }
      hs.push(Math.max(2, Math.pow(pk, 0.75) * (wh - 6))); xs.push(x);
      const mid = (t0 + t1) / 2;
      flags.push(runs.some((r) => mid >= r.from && mid <= r.to) ? 1 : 0);
    }
    for (const [cv, loud, faint] of palette) {
      cv.width = Math.round(width * dpr); cv.height = Math.round(wh * dpr);
      const g = cv.getContext("2d"); if (!g) continue;
      g.clearRect(0, 0, cv.width, cv.height);
      for (let i = 0; i < hs.length; i++) {
        const h = hs[i] * dpr;
        g.fillStyle = flags[i] ? faint : loud;
        g.fillRect(Math.round(xs[i] * dpr), Math.round((cv.height - h) / 2), Math.round(BAR * dpr), Math.round(h));
      }
    }
  }, [peaks, width, dur, wh, quiet, view.start, view.end, tileTick, level, p.rev]);

  const shown = drag ?? now;
  const headX = xOf(view, shown);
  const headOff = headX < 0 || headX > 1;
  const pct = Math.min(100, Math.max(0, headX * 100));
  const rectOf = () => surface.current!.getBoundingClientRect();
  const timeAt = (clientX: number) => {
    const r = rectOf();
    const x = Math.min(r.width, Math.max(0, clientX - r.left));
    return { x, t: Math.min(dur, Math.max(0, timeOf(live.current.view, x / r.width))) };
  };

  // ---- pointer: a click or drag scrubs; two fingers zoom and pan --------------------------------------------------------
  const fingers = useRef(new Map<number, number>());
  const pinching = useRef<{ a: number; b: number } | null>(null);
  const before = useRef(0);
  const pointerMoved = (clientX: number) => {
    const { x, t } = timeAt(clientX);
    setHover({ x, t });
    if (edgeDrag.current && live.current.p.range && live.current.p.onRange) live.current.p.onRange(setEdge(live.current.p.range, edgeDrag.current, t, live.current.dur));
    else if (drag !== null || scrub.current) { setDrag(t); p.seek(t); }
  };
  live.current.pm = pointerMoved;
  const down = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const v = p.video.current;
    capture(e);
    if (e.pointerType === "touch") {
      fingers.current.set(e.pointerId, e.clientX);
      if (fingers.current.size === 2) {
        // the first finger already scrubbed: a pinch isn't a scrub, so put the playhead back
        const [a, b] = [...fingers.current.values()];
        pinching.current = { a, b };
        scrub.current = null; setDrag(null);
        p.seek(before.current);
        if (resume.current) v?.play().catch(() => undefined);
        return;
      }
      before.current = v?.currentTime ?? 0;
    }
    resume.current = !!v && !v.paused;
    if (resume.current) v!.pause();
    const { t } = timeAt(e.clientX);
    setDrag(t); p.seek(t);
    scrub.current = { x: e.clientX };
    // a mouse click leaves the slider ready for the arrow keys; a finger doesn't need (or want) the focus ring
    if (e.pointerType !== "touch") (e.currentTarget as HTMLElement).querySelector<HTMLElement>("[role=slider]")?.focus({ preventScroll: true });
  };
  const move = (e: PointerEvent) => {
    if (fingers.current.has(e.pointerId)) fingers.current.set(e.pointerId, e.clientX);
    if (pinching.current && fingers.current.size >= 2) {
      const [a, b] = [...fingers.current.values()];
      const r = rectOf();
      const g = pinch(pinching.current, { a, b });
      pinching.current = { a, b };
      const v = live.current.view;
      const anchor = timeOf(v, Math.min(1, Math.max(0, (g.centre - r.left) / r.width)));
      let next = zoomAt(v, g.factor, anchor, dur);
      next = panBy(next, -(g.move / r.width) * spanOf(next), dur);
      manual(); setView(next);
      return;
    }
    if (scrub.current) scrub.current.x = e.clientX;
    pointerMoved(e.clientX);
  };
  const up = (e: PointerEvent) => {
    fingers.current.delete(e.pointerId);
    release(e);
    if (pinching.current) { if (fingers.current.size < 2) { pinching.current = null; if (fingers.current.size === 0) { scrub.current = null; setDrag(null); } } return; }
    scrub.current = null;
    if (drag === null) return;
    setDrag(null);
    if (resume.current) p.video.current?.play().catch(() => undefined);
  };

  // ---- wheel and gestures: ctrl+wheel (a trackpad pinch) zooms; a sideways scroll pans -----------------------------
  useEffect(() => {
    const el = root.current, surf = surface.current; if (!el || !surf) return;
    const px = (e: WheelEvent, n: number) => n * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
    const onWheel = (e: WheelEvent) => {
      const L = live.current, r = surf.getBoundingClientRect();
      if (e.ctrlKey) {
        e.preventDefault();
        const t = timeOf(L.view, Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
        manual(); setView(zoomAt(L.view, wheelFactor(px(e, e.deltaY)), t, L.dur));
        return;
      }
      const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0;
      if (dx && !isFull(L.view, L.dur)) { e.preventDefault(); manual(); setView(panBy(L.view, (px(e, dx) / r.width) * spanOf(L.view), L.dur)); }
    };
    // Safari on a Mac sends a pinch as gesture events, not ctrl+wheel
    let g0: View | null = null;
    const at = (v: View, clientX: number) => { const r = surf.getBoundingClientRect(); return timeOf(v, Math.min(1, Math.max(0, (clientX - r.left) / r.width))); };
    const onStart = (e: Event) => { e.preventDefault(); g0 = live.current.view; };
    const onChange = (e: Event) => {
      e.preventDefault();
      const g = e as Event & { scale: number; clientX: number };
      if (g0) { manual(); setView(zoomAt(g0, g.scale, at(g0, g.clientX), live.current.dur)); }
    };
    const onEnd = (e: Event) => { e.preventDefault(); g0 = null; };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", onStart); el.addEventListener("gesturechange", onChange); el.addEventListener("gestureend", onEnd);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onStart); el.removeEventListener("gesturechange", onChange); el.removeEventListener("gestureend", onEnd);
    };
  }, []);

  const zoomBy = (what: "in" | "out" | "fit") => { manual(); setView(keyZoom(live.current.view, what, p.video.current?.currentTime ?? now, live.current.dur)); };

  const sliderKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "+" || e.key === "=") { e.preventDefault(); e.stopPropagation(); zoomBy("in"); return; }
    if (e.key === "-" || e.key === "_") { e.preventDefault(); e.stopPropagation(); zoomBy("out"); return; }
    if (e.key === "0") { e.preventDefault(); e.stopPropagation(); zoomBy("fit"); return; }
    let a: KeyAction | null = null;
    if (e.key === "ArrowLeft") a = { type: "step", frames: e.shiftKey ? -10 : -1 };
    else if (e.key === "ArrowRight") a = { type: "step", frames: e.shiftKey ? 10 : 1 };
    else if (e.key === "ArrowDown") a = { type: "nudge", seconds: -1 };
    else if (e.key === "ArrowUp") a = { type: "nudge", seconds: 1 };
    else if (e.key === "PageDown") a = { type: "nudge", seconds: -10 };
    else if (e.key === "PageUp") a = { type: "nudge", seconds: 10 };
    else if (e.key === "Home") a = { type: "home" };
    else if (e.key === "End") a = { type: "end" };
    if (!a) return;
    e.preventDefault(); e.stopPropagation();
    p.act(a);
  };

  const edgeDown = (edge: "in" | "out") => (e: PointerEvent) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    capture(e);
    edgeDrag.current = edge;
    scrub.current = { x: e.clientX };
  };
  const edgeMove = (e: PointerEvent) => {
    const edge = edgeDrag.current;
    if (!edge || !p.range || !p.onRange) return;
    if (scrub.current) scrub.current.x = e.clientX;
    p.onRange(setEdge(p.range, edge, timeAt(e.clientX).t, dur));
  };
  const edgeUp = (e: PointerEvent) => { edgeDrag.current = null; scrub.current = null; release(e); };
  const edgeKey = (edge: "in" | "out") => (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || !p.range || !p.onRange) return;
    const cur = (edge === "in" ? p.range.in : p.range.out) ?? 0;
    const frame = 1 / (p.fps ?? 25);
    const by = e.key === "ArrowLeft" ? -(e.shiftKey ? 10 : 1) * frame : e.key === "ArrowRight" ? (e.shiftKey ? 10 : 1) * frame : e.key === "ArrowDown" ? -1 : e.key === "ArrowUp" ? 1 : null;
    if (by === null) { if (e.key === "Home") { e.preventDefault(); e.stopPropagation(); p.onRange(setEdge(p.range, edge, 0, dur)); } else if (e.key === "End") { e.preventDefault(); e.stopPropagation(); p.onRange(setEdge(p.range, edge, dur, dur)); } return; }
    e.preventDefault(); e.stopPropagation();
    p.onRange(setEdge(p.range, edge, cur + by, dur));
  };

  const ticks = useMemo(() => rulerTicksIn(view, width, 76, p.wholeSecondTicks ? 1 : 0), [view.start, view.end, width, p.wholeSecondTicks]);
  const fpx = framePx(view, width, p.fps);
  const frameTicks = showFrameTicks(fpx);
  const segAt = hover && p.segments ? p.segments.find((s) => hover.t >= s.t && hover.t < s.e) : undefined;
  const whole = Math.floor(shown);
  const noteCount = p.markers.filter((m) => m.kind === "note").length;
  const noteKinds = (["waiting", "sent", "check", "resolved"] as NoteKey[])
    .map((k) => [k, p.markers.filter((m) => m.kind === "note" && noteState({ status: m.status ?? "open" }).key === k).length] as [NoteKey, number])
    .filter(([, n]) => n > 0);
  const joinCount = p.markers.length - noteCount;
  const bubbleX = hover ? Math.min(width - 78, Math.max(78, hover.x)) : 0;
  const slack = (14 / width) * span;
  const segs = p.segments?.filter((s) => overlaps(view, s.t, s.e)) ?? [];
  const edgePos = (at: number) => `${Math.min(100, Math.max(0, xOf(view, at) * 100))}%`;
  const edgeOff = (at: number) => { const x = xOf(view, at); return x < 0 || x > 1; };
  const atMax = span <= minSpan(dur) + 1e-6;

  return (
    <div class={"tl" + (compact ? " compact" : "")} ref={root}>
      <div class="tl-top">
        <Minimap dur={dur} view={view} onView={setView} wave={peaks} markers={p.markers} now={shown} compact={compact} controls={id} onZoomKey={zoomBy} onManual={manual} />
        <div class="tl-zoom" role="group" aria-label="Zoom the timeline">
          <button class="cb" disabled={!zoomed} onClick={hit(() => zoomBy("out"))} aria-label="Zoom out" title="Zoom out (-)" aria-keyshortcuts="-"><MinusIcon /></button>
          <button class="cb" disabled={atMax} onClick={hit(() => zoomBy("in"))} aria-label="Zoom in" title="Zoom in (+)" aria-keyshortcuts="+"><PlusIcon /></button>
          <button class="cb" disabled={!zoomed} onClick={hit(() => zoomBy("fit"))} aria-label="Show the whole cut" title="Show the whole cut (0)" aria-keyshortcuts="0"><FitIcon /></button>
          <span class="tl-zoomlabel mono" role="status" aria-label={zoomed ? `Zoom ${zoomLabel(view, dur)}` : "Zoom 1x, the whole cut"}>{zoomLabel(view, dur)}</span>
        </div>
      </div>
      <div class={"tl-ruler" + (frameTicks ? " frames" : "")} aria-hidden="true"
        style={frameTicks ? { ["--fpx" as any]: `${fpx}px`, ["--foff" as any]: `${-((view.start * (p.fps ?? 25)) % 1) * fpx}px` } : undefined}>
        {ticks.filter((k) => k.x * width < width - 36).map((k) => <span class="tl-tick" style={{ left: `${k.x * 100}%` }}><b>{k.label}</b></span>)}
      </div>
      <div class="tl-surface" id={id} ref={surface} onPointerDown={down as any} onPointerMove={move as any} onPointerUp={up as any} onPointerCancel={up as any} onPointerLeave={() => { if (drag === null) setHover(null); }}>
        {!compact && (
          <div class="tl-segs" aria-hidden="true">
            {segs.map((s) => {
              const a = Math.max(s.t, view.start), b = Math.min(s.e, view.end);
              const px = ((b - a) / span) * width;
              const name = s.beat || "";
              return <i class={"tl-seg " + s.layout} style={{ left: `${xOf(view, a) * 100}%`, width: `${((b - a) / span) * 100}%` }}>{name && px >= name.length * 6.8 + 16 ? <span>{name}</span> : null}</i>;
            })}
          </div>
        )}
        <div class="tl-wave" style={{ height: `${wh}px` }}>
          <canvas ref={base} aria-hidden="true" />
          <canvas ref={played} aria-hidden="true" class="tl-played" style={{ clipPath: `inset(0 ${100 - pct}% 0 0)` }} />
          {wave.kind !== "wave" && wave.kind !== "unrendered" && (
            <div class="tl-msg" role="status">
              <span>{wave.kind === "loading" ? "Reading the audio…" : wave.kind === "silent" ? "This cut has no audio, so there is no waveform." : wave.message}</span>
            </div>
          )}
        </div>
        {hover && drag === null && (
          <div class="tl-hover" aria-hidden="true" style={{ left: `${hover.x}px` }}>
            <span class="tl-bubble" style={{ left: `${bubbleX - hover.x}px` }}><b class="mono">{clock(hover.t)}</b>{segAt ? ` ${segAt.beat || "…"} · ${segAt.layout === "screen" ? "screen" : "camera"}` : ""}</span>
          </div>
        )}
        {p.range && hasRange(p.range) && (
          <>
            <div class={"tl-range" + (p.loopOn ? " on" : "")} aria-hidden="true" style={{ left: edgePos(p.range.in ?? 0), width: `${Math.max(0, Math.min(100, xOf(view, p.range.out ?? dur) * 100) - Math.max(0, xOf(view, p.range.in ?? 0) * 100))}%` }} />
            {(["in", "out"] as const).map((edge) => {
              const at = edge === "in" ? p.range!.in : p.range!.out;
              if (at === null) return null;
              return (
                <div class={"tl-edge " + edge + (edgeOff(at) ? " off" : "")} role="slider" tabIndex={0} aria-label={edge === "in" ? "Loop start" : "Loop end"} aria-valuemin={0} aria-valuemax={Math.floor(dur)}
                  aria-valuenow={Math.floor(at)} aria-valuetext={clock(at)} style={{ left: edgePos(at) }}
                  onPointerDown={edgeDown(edge) as any} onPointerMove={edgeMove as any} onPointerUp={edgeUp as any} onPointerCancel={edgeUp as any} onKeyDown={edgeKey(edge) as any}><i aria-hidden="true" /></div>
              );
            })}
          </>
        )}
        <div class={"tl-head" + (headOff ? " off" : "")} role="slider" tabIndex={0} aria-label={`Timeline, ${p.version}`} aria-valuemin={0} aria-valuemax={Math.floor(dur)} aria-valuenow={whole}
          aria-valuetext={`${clock(whole)} of ${clock(dur)}`} style={{ left: `${pct}%` }} onKeyDown={sliderKey as any}>
          <i aria-hidden="true" />
        </div>
      </div>
      <div class="tl-marks" role="group" aria-label="Notes and joins to look at">
        {p.markers.filter((m) => visible(view, m.at, slack)).map((m) => {
          const x = xOf(view, m.at);
          return (
            <button class={"mk mk-" + m.kind + (m.kind === "note" ? " st-" + noteState({ status: m.status ?? "open", fixedIn: m.fixedIn, reopened: m.reopened }).key : "") + (x < 0.12 ? " lft" : x > 0.88 ? " rgt" : "")}
              style={{ left: `${Math.min(100, Math.max(0, x * 100))}%` }} onClick={() => p.seek(m.seekAt)}
              aria-label={m.kind === "note" ? `Note at ${clock(m.at)}, ${noteState({ status: m.status ?? "open", fixedIn: m.fixedIn, reopened: m.reopened }).label}: ${m.text}. Jump to it.` : `Join to look at, ${clock(m.at)}: ${m.text}. Plays from a second before the cut.`}>
              <i aria-hidden="true" />
              <span class="mk-card" aria-hidden="true">
                <b class="mono">{clock(m.at)}</b>
                <span>{m.kind === "note" ? m.text : `Join: ${m.text}`}</span>
                <small>{m.kind === "note" ? `${noteState({ status: m.status ?? "open", fixedIn: m.fixedIn, reopened: m.reopened }).label}. Click to jump.` : "Click to play from a second before the cut."}</small>
              </span>
            </button>
          );
        })}
      </div>
      <div class="legend">
        {!p.hideTime && <span class="mono now">{clock(shown)} / {clock(dur)}</span>}
        {!compact && <span><i class="lg lg-cam" aria-hidden="true" />On camera</span>}
        {!compact && <span><i class="lg lg-scr" aria-hidden="true" />Screen, you in the corner</span>}
        <span><svg class="lg-wave" width="18" height="12" viewBox="0 0 18 12" aria-hidden="true"><path d="M2 5v2M5 3v6M8 1v10M11 4v4M14 2v8M17 5v2" stroke="currentColor" stroke-width="2" /></svg>Audio, the played part darker</span>
        {quiet.length > 0 && <span><svg class="lg-wave faint" width="18" height="12" viewBox="0 0 18 12" aria-hidden="true"><path d="M2 5.5v1M5 5.5v1M8 5v2M11 5.5v1M14 5.5v1M17 5.5v1" stroke="currentColor" stroke-width="2" /></svg>Quiet for 0.6 s or more</span>}
        {p.range && hasRange(p.range) && <span><i class="lg lg-loop" aria-hidden="true" />Loop {rangeLabel(p.range, dur)}</span>}
        {noteKinds.length === 0 && <span><i class="lg lg-note st-waiting" aria-hidden="true" />Note</span>}
        {noteKinds.map(([k, n]) => <span><i class={"lg lg-note st-" + k} aria-hidden="true" />{NOTE_LEGEND[k]} ({n})</span>)}
        {joinCount > 0 && <span><i class="lg lg-join" aria-hidden="true" />Join to look at ({joinCount})</span>}
      </div>
    </div>
  );
}
