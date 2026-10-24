import { StudioIcon } from "./StudioIcon.js";
import { hit } from "./focus.js";
import { KeySelect } from "./KeySelect.js";
import type { LoopRange } from "./timeline-math.js";
import { SPEEDS, clock, hasRange, speedLabel } from "./timeline-math.js";

export interface ControlBarProps {
  t: number;
  dur: number;
  playing: boolean;
  onToggle(): void;
  onStep(frames: number): void;
  speed: number;
  onSpeed(x: number): void;
  loopOn: boolean;
  onLoop(): void;
  range: LoopRange;
  onEdge(edge: "in" | "out"): void;
  onClear(): void;
  muted: boolean;
  onMute(): void;
  onFullscreen(): void;
}

/** Full screen is there on desktops and iPads; on an iPhone only the video element itself can do it. */
const canFullscreen = typeof document !== "undefined" && (document.fullscreenEnabled || "webkitEnterFullscreen" in HTMLVideoElement.prototype);

/** The video's controls, under the picture: frame steps, play, speed, loop (the whole cut, or a range set with In and Out), sound, full screen. */
export function ControlBar(p: ControlBarProps) {
  return (
    <div class="cbar" role="group" aria-label="Playback controls">
      <button class="cb" onClick={hit(() => p.onStep(-1))} aria-label="Back one frame" title="Back one frame (Left)" aria-keyshortcuts="ArrowLeft"><StudioIcon name="back"/></button>
      <button class="cb play" onClick={hit(p.onToggle)} aria-label={p.playing ? "Pause" : "Play"} title={p.playing ? "Pause (Space)" : "Play (Space)"} aria-keyshortcuts="Space">{p.playing ? <StudioIcon name="pause"/> : <StudioIcon name="play"/>}</button>
      <button class="cb" onClick={hit(() => p.onStep(1))} aria-label="Forward one frame" title="Forward one frame (Right)" aria-keyshortcuts="ArrowRight"><StudioIcon name="forward"/></button>
      <span class="cb-time mono" aria-hidden="true"><b>{clock(p.t)}</b> / {clock(p.dur)}</span>
      <KeySelect class="cb-speed" label="Playback speed" title="Playback speed (< slower, > faster)" value={String(p.speed)} options={SPEEDS.map((x) => ({ value: String(x), label: speedLabel(x) }))} onPick={(x) => p.onSpeed(Number(x))} />
      <span class="spacer" />
      <button class="cb" aria-pressed={p.muted} onClick={hit(p.onMute)} aria-label="Mute" title="Mute (M)" aria-keyshortcuts="M"><StudioIcon name={p.muted ? "muted" : "volume"}/></button>
      <details class="cb-options" onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); e.currentTarget.open = false; e.currentTarget.querySelector("summary")?.focus(); } }} onFocusOut={e => { if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node)) e.currentTarget.open = false; }}><summary class="cb" aria-label="Playback options" title="Playback options"><StudioIcon name="sliders"/></summary><div class="cb-options-panel"><h3>Playback options</h3><div class="cb-options-row"><span>Speed</span><KeySelect class="cb-speed" label="Advanced playback speed" value={String(p.speed)} options={SPEEDS.map(x => ({ value: String(x), label: speedLabel(x) }))} onPick={x => p.onSpeed(Number(x))}/></div><div class="cb-options-row"><span>Step a frame</span><button class="cb" aria-label="Step back one frame" onClick={hit(() => p.onStep(-1))}><StudioIcon name="back"/></button><button class="cb" aria-label="Step forward one frame" onClick={hit(() => p.onStep(1))}><StudioIcon name="forward"/></button></div><div class="cb-options-row">      <button class="cb" aria-pressed={p.loopOn} onClick={hit(p.onLoop)} aria-label="Loop" title={p.loopOn ? "Loop is on (R)" : "Loop (R)"} aria-keyshortcuts="R"><StudioIcon name="redo"/></button>
      <button class="cb txt" aria-pressed={p.range.in !== null} onClick={hit(() => p.onEdge("in"))} aria-label="Set loop start here" title="Set loop start here (I)" aria-keyshortcuts="I">In</button>
      <button class="cb txt" aria-pressed={p.range.out !== null} onClick={hit(() => p.onEdge("out"))} aria-label="Set loop end here" title="Set loop end here (O)" aria-keyshortcuts="O">Out</button>
      {hasRange(p.range) && <button class="cb txt" onClick={hit(p.onClear)} aria-label="Clear the loop range" title="Clear the loop range (X)" aria-keyshortcuts="X">Clear</button>}
</div><p>Loop the whole cut, or set In and Out around the moment you’re refining.</p></div></details>
      {canFullscreen && <button class="cb" onClick={hit(p.onFullscreen)} aria-label="Full screen" title="Full screen (F)" aria-keyshortcuts="F"><StudioIcon name="expand"/></button>}
    </div>
  );
}
