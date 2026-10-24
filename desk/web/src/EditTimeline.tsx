import { useEffect, useState } from 'preact/hooks';
import { tc, tcLong } from './api.js';
import { effectIssue } from './studio-state.js';
import { StudioIcon } from './StudioIcon.js';
import { timelinePage } from './timeline-layout.js';
type Row = { id: string; type: string; at: number; duration: number; enabled: boolean; [key: string]: any };
/** Labels have their own column. Even a one-frame effect has a full-size click target. */
export function EditTimeline({ expanded, duration, time, fps, description, effects, boundaries, selected, nameOf, onSeek, onSelect, onAdd }: {
  description?: string; expanded: boolean; duration: number; time: number; fps: number; effects: Row[]; boundaries: number[]; selected: string | null;
  nameOf: (type: string) => string; onSeek: (t: number) => void; onSelect: (e: any) => void; onAdd: () => void;
}) {
  const [page, setPage] = useState(0);
  const layout = timelinePage(effects.length, page);
  useEffect(() => { const i = effects.findIndex(e => e.id === selected); if (i >= 0) setPage(Math.floor(i / 3)); }, [selected]);
  const position = Math.max(0, Math.min(100, time / Math.max(duration, .001) * 100));
  return <div class="vs-timeline" id="effect-timing" aria-label="Effects timeline">
    <div class="vs-time-grid">
      <div class="vs-track-heading"><span>{expanded ? 'Effect timing' : 'Your video'}</span><small>{description ?? `${effects.length} effect${effects.length === 1 ? '' : 's'}`}</small></div>
      <div class="vs-ruler" style={{ '--playhead': `${position}%` }}>
        <div class="vs-ticks" aria-hidden="true">{[0, 1, 2, 3, 4].map(i => <span style={{ left: `${i * 25}%` }}>{tc(duration * i / 4)}</span>)}</div>
        <div class="vs-seek-track" aria-hidden="true"><span style={{ width: `${position}%` }}/>{boundaries.map(t => <i style={{ left: `${t / duration * 100}%` }}/>)}</div>
        <div class="vs-playhead-head" aria-hidden="true"/>
        <input type="range" aria-label="Video playhead" aria-valuetext={`${tcLong(time)} of ${tc(duration)}`} min="0" max={Math.max(0, duration - 1 / fps)} step={1 / fps} value={time} onInput={e => onSeek(Number(e.currentTarget.value))}/>
      </div>
    </div>
    <div class="vs-tracks" hidden={!expanded}>
      {effects.slice(layout.start, layout.end).map((e, i) => {
        const issue = effectIssue(e as any, duration, boundaries);
        return <button key={e.id} class={'vs-track-row' + (selected === e.id ? ' selected' : '') + (!e.enabled ? ' disabled' : '') + (issue ? ' needs-input' : '')} aria-label={`Edit ${nameOf(e.type)} at ${tcLong(e.at)}`} aria-pressed={selected === e.id} onClick={() => onSelect(e)}>
          <span class="vs-track-name"><span class={'vs-track-symbol tone-' + ((layout.start + i) % 3)}><StudioIcon name="sparkle"/></span><span><b>{nameOf(e.type)}</b><small>{issue ? 'Needs content' : !e.enabled ? 'Switched off' : `${tcLong(e.at)} · ${e.duration.toFixed(1)}s`}</small></span></span>
          <span class="vs-track-lane" aria-hidden="true"><span class={'vs-clip tone-' + ((layout.start + i) % 3)} style={{ left: `${e.at / duration * 100}%`, width: `${Math.min(100 - e.at / duration * 100, e.duration / duration * 100)}%` }}><i/><i/></span><span class="vs-lane-playhead" style={{ left: `${position}%` }}/></span>
        </button>;
      })}
      {!effects.length && <button class="vs-empty-track" onClick={onAdd}><StudioIcon name="plus"/>Add an effect to highlight a moment<span>At {tcLong(time)}</span></button>}
    </div>
    {expanded && effects.length > 3 && <div class="vs-timeline-pages"><span>Effects {layout.start + 1}–{layout.end} of {effects.length}</span><button class="vs-icon-btn" disabled={!layout.page} aria-label="Previous effects" onClick={() => setPage(layout.page - 1)}><StudioIcon name="left"/></button><button class="vs-icon-btn" disabled={layout.end === effects.length} aria-label="Next effects" onClick={() => setPage(layout.page + 1)}><StudioIcon name="right"/></button></div>}
  </div>;
}
