import { useEffect, useRef, useState } from "preact/hooks";
import type { Marker } from "./timeline-math.js";
import { clock } from "./timeline-math.js";
import type { Wave } from "./peaks.js";
import { dragEdge, dragWindow, jumpWindow, panBy, spanOf, type View } from "./timeline-zoom.js";

export interface MinimapProps {
  dur: number;
  view: View;
  onView(v: View): void;
  /** The cut's overview waveform, when there is one. */
  wave: Wave | null;
  markers: Marker[];
  /** Where the playhead is, seconds. */
  now: number;
  compact?: boolean;
  /** The id of the timeline this scrolls. */
  controls: string;
  /** + - 0 on the window: the timeline works out the anchor. */
  onZoomKey(a: "in" | "out" | "fit"): void;
  /** Called when the person moves the window, so playback doesn't snatch it back. */
  onManual(): void;
}

const PITCH = 2;

type Drag = { mode: "pan" | "l" | "r"; x: number; view: View };

/**
 * The whole cut in one thin strip, with the part now on screen outlined. Drag the outline to scroll, drag its ends to zoom,
 * click anywhere else to go there. It is also the timeline's scrollbar: the outline is focusable, with arrow keys to scroll.
 */
export function Minimap(p: MinimapProps) {
  const box = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag | null>(null);
  const [w, setW] = useState(300);
  const h = p.compact ? 24 : 28;

  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(40, el.clientWidth)));
    ro.observe(el); setW(Math.max(40, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = cv.current; if (!c) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    const g = c.getContext("2d"); if (!g) return;
    g.clearRect(0, 0, c.width, c.height);
    if (!p.wave) return;
    g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--wave").trim() || "#888";
    const { peaks, duration } = p.wave, n = peaks.length;
    const bars = Math.max(1, Math.floor(w / PITCH));
    for (let i = 0; i < bars; i++) {
      const t0 = (i / bars) * p.dur, t1 = ((i + 1) / bars) * p.dur;
      if (t0 >= duration) break;
      const a = Math.min(n - 1, Math.floor((t0 / duration) * n)), b = Math.min(n, Math.max(a + 1, Math.ceil((Math.min(t1, duration) / duration) * n)));
      let pk = 0;
      for (let k = a; k < b; k++) if (peaks[k] > pk) pk = peaks[k];
      const bh = Math.max(1.5 * dpr, Math.pow(pk, 0.75) * (h - 6) * dpr);
      g.fillRect(Math.round(i * PITCH * dpr), Math.round((c.height - bh) / 2), Math.round(1.4 * dpr), Math.round(bh));
    }
  }, [p.wave, p.dur, w, h]);

  const span = spanOf(p.view);
  const full = span >= p.dur - 1e-6;
  const winPx = (span / p.dur) * w;
  const timeAt = (clientX: number) => {
    const r = box.current!.getBoundingClientRect();
    return Math.min(p.dur, Math.max(0, ((clientX - r.left) / r.width) * p.dur));
  };

  const down = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    const handle = target.closest<HTMLElement>("[data-h]")?.dataset.h as "l" | "r" | undefined;
    const inWin = !!target.closest(".tl-win");
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* not an active pointer */ }
    p.onManual();
    let v = p.view;
    if (!handle && !inWin) { v = jumpWindow(v, timeAt(e.clientX), p.dur); p.onView(v); }
    drag.current = { mode: handle ?? "pan", x: e.clientX, view: v };
    if (e.pointerType !== "touch") box.current?.querySelector<HTMLElement>(".tl-win")?.focus({ preventScroll: true });
    e.stopPropagation();
  };
  const move = (e: PointerEvent) => {
    const d = drag.current; if (!d) return;
    p.onManual();
    if (d.mode === "pan") p.onView(dragWindow(d.view, (e.clientX - d.x) / box.current!.getBoundingClientRect().width, p.dur));
    else p.onView(dragEdge(d.view, d.mode === "l" ? "start" : "end", timeAt(e.clientX), p.dur));
  };
  const up = (e: PointerEvent) => { drag.current = null; try { (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId); } catch { /* it had already let go */ } };

  const key = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    let next: View | null = null;
    const step = span * (e.shiftKey ? 0.5 : 0.1);
    if (e.key === "ArrowLeft") next = panBy(p.view, -step, p.dur);
    else if (e.key === "ArrowRight") next = panBy(p.view, step, p.dur);
    else if (e.key === "PageUp") next = panBy(p.view, -span * 0.9, p.dur);
    else if (e.key === "PageDown") next = panBy(p.view, span * 0.9, p.dur);
    else if (e.key === "Home") next = panBy(p.view, -p.dur, p.dur);
    else if (e.key === "End") next = panBy(p.view, p.dur, p.dur);
    else if (e.key === "+" || e.key === "=") { e.preventDefault(); e.stopPropagation(); p.onManual(); p.onZoomKey("in"); return; }
    else if (e.key === "-" || e.key === "_") { e.preventDefault(); e.stopPropagation(); p.onManual(); p.onZoomKey("out"); return; }
    else if (e.key === "0") { e.preventDefault(); e.stopPropagation(); p.onManual(); p.onZoomKey("fit"); return; }
    if (!next) return;
    e.preventDefault(); e.stopPropagation(); p.onManual();
    p.onView(next);
  };

  const pct = (t: number) => `${(Math.min(p.dur, Math.max(0, t)) / p.dur) * 100}%`;
  return (
    <div class={"tl-map" + (p.compact ? " compact" : "")} ref={box} onPointerDown={down as any} onPointerMove={move as any} onPointerUp={up as any} onPointerCancel={up as any}>
      <canvas ref={cv} aria-hidden="true" />
      <div class="tl-map-marks" aria-hidden="true">
        {p.markers.map((m) => <i class={"tl-map-mk mm-" + m.kind} style={{ left: pct(m.at) }} />)}
      </div>
      <i class="tl-map-head" aria-hidden="true" style={{ left: pct(p.now) }} />
      <div class={"tl-win" + (full ? " full" : "")} role="scrollbar" tabIndex={0} aria-controls={p.controls} aria-orientation="horizontal"
        aria-label="Which part of the cut the timeline shows"
        aria-valuemin={0} aria-valuemax={Math.max(0, Math.floor(p.dur - span))} aria-valuenow={Math.floor(p.view.start)}
        aria-valuetext={full ? "The whole cut" : `${clock(p.view.start)} to ${clock(p.view.end)} of ${clock(p.dur)}`}
        style={{ left: pct(p.view.start), width: `${(span / p.dur) * 100}%` }} onKeyDown={key as any}>
        {winPx >= 36 && <><b class="tl-win-h l" data-h="l" aria-hidden="true" /><b class="tl-win-h r" data-h="r" aria-hidden="true" /></>}
      </div>
    </div>
  );
}
