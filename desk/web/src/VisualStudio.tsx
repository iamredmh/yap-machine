import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { api, media, tc, tcLong } from './api.js';
import { LivePreview, StylePreview } from './LivePreview.js';
import { activeEffectsAtTime, livePlan } from './live-plan.js';
import { EditTimeline } from './EditTimeline.js';
import { StudioIcon } from './StudioIcon.js';
import { captionEditMessage, captionEditState, type CaptionEditState } from './caption-edit-state.js';
import './visual-studio.css';
import { changeHistory, clampTime, effectIssue, historyOf, needsPresenterMask, recoverDraft, travelHistory, visualSettingsOf as settingsOf, type History, type VisualEffect as Effect, type VisualSettings as Settings } from './studio-state.js';
import { brandNatHasTopPanel, brandNatNeedsMask, resolveBrandNat, type BrandNat } from '../../src/core/brand-nat.js';
type Kind = { id: string; name: string; group: string; description: string; asset: boolean; matte: boolean; pickerHidden?: boolean; variants?: { type: string; name: string }[] };
type Style = { id: string; name: string; summary: string; accent: string; background: string; font: string; signature: string; family?: string; brandNat?: BrandNat };
type NatControl = 'caption' | 'hook' | 'layout' | 'finish' | 'position';
type NatOption = { code: string; name: string; description: string; matte?: boolean };
type Panel = 'style' | 'effects' | 'captions' | 'export';
const blank: Settings = { preset: 'original', motion: 'balanced', effects: [] };
const same = (a: Settings, b: Settings) => JSON.stringify(a) === JSON.stringify(b);
const storage = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, put: (k: string, v: any) => { try { v ? localStorage.setItem(k, JSON.stringify(v)) : localStorage.removeItem(k); } catch { /* browser storage optional */ } } };

export function VisualStudio({ project, captions, captionEdits = { queued: 0, withAgent: 0, saving: false }, initialVersion, onVersion }: { project: any; captions?: ComponentChildren; captionEdits?: CaptionEditState; initialVersion?: string; onVersion?: (v: string) => void }) {
  const cuts = [...project.shorts, ...project.versions].sort((a: any, b: any) => b.version.localeCompare(a.version, undefined, { numeric: true }));
  const [version, setVersion] = useState(cuts.some((c: any) => c.version === initialVersion) ? initialVersion! : cuts[0]?.version ?? '');
  useEffect(() => { if (version) onVersion?.(version); }, [version]);
  const [catalog, setCatalog] = useState<{ styles: Style[]; legacyStyles?: Style[]; effects: Kind[]; brandNat?: { name: string; options: Record<NatControl, NatOption[]> }; capabilities?: { personMatte: boolean; personMatteReason?: string | null } } | null>(null);
  const [data, setData] = useState<any>(null), [saved, setSaved] = useState<Settings>(blank);
  const [history, setHistory] = useState<History<Settings>>(historyOf(blank));
  const historyRef = useRef(history); historyRef.current = history;
  const settings = history.present;
  const [selected, setSelected] = useState<string | null>(null), [filter, setFilter] = useState('All'), [search, setSearch] = useState('');
  const [panel, setPanel] = useState<Panel>('style'), [focus, setFocus] = useState(false), [compare, setCompare] = useState(false);
  const [time, setTime] = useState(.8), [seek, setSeek] = useState({ time: .8, id: 0 });
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false), [uploading, setUploading] = useState(false);
  const [job, setJob] = useState<any>(null), [result, setResult] = useState<any>(null), [exported, setExported] = useState<any>(null);
  const [apply, setApply] = useState(false), [notice, setNotice] = useState('');
  const [dismissedEffect, setDismissedEffect] = useState<string | null>(null);
  const [source, setSource] = useState<any>(null), [sourceError, setSourceError] = useState(''), [preparing, setPreparing] = useState(false), [retry, setRetry] = useState(0);
  const [previewReady, setPreviewReady] = useState(false);
  const [renderedDuration, setRenderedDuration] = useState(0);
  const [playback, setPlayback] = useState({ playing: false, muted: true });
  const [transport, setTransport] = useState({ action: '', id: 0 });
  const [timing, setTiming] = useState(() => innerHeight >= 900 && innerWidth > 760);
  const [previewMode, setPreviewMode] = useState<'live' | 'rendered'>('live');
  const editGeneration = useRef(0), renderGenerations = useRef<Record<string, number>>({});
  const lastEdit = useRef({ key: '', time: 0 });
  const scope = `${project.id}:${version}`, scopeRef = useRef(scope); scopeRef.current = scope;
  const draftKey = `yap:visual-draft:${scope}`;
  const duration = data?.timeline.duration ?? 0;
  const boundaries = data?.timeline.segments.slice(1).map((s: any) => s.t) ?? [];
  const dirty = apply || !same(settings, saved);
  const captionMessage = captionEditMessage(captionEdits);
  const captionEditsRef = useRef(captionEdits); captionEditsRef.current = captionEdits;
  const rendering = job?.state === 'running';
  const activeDuration = previewMode === 'rendered' && renderedDuration ? renderedDuration : duration;
  const effect = settings.effects.find(e => e.id === selected);
  const kind = catalog?.effects.find(k => k.id === effect?.type);
  const effectFamily = catalog?.effects.find(k => k.variants?.some(v => v.type === effect?.type)) ?? kind;
  const matteUnavailable = catalog?.capabilities?.personMatte === false;
  const matteReason = catalog?.capabilities?.personMatteReason ?? 'Automatic cutouts need macOS 12 or later and Apple’s Command Line Tools. Disable cutout effects to export on this computer.';
  const nat = resolveBrandNat(settings.preset, settings.brandNat);
  const topPanel = brandNatHasTopPanel(nat, data?.timeline);
  const natMask = brandNatNeedsMask(settings.preset, nat, data?.timeline);
  const natIssue = natMask && matteUnavailable ? matteReason + ' Choose an opening title and finish without cutouts, and switch off speaker overlap below.' : null;
  const issues = settings.effects.map(e => ({ id: e.id, message: effectIssue(e, duration, boundaries)
    || (e.enabled && matteUnavailable && catalog?.effects.some(k => k.id === e.type && k.matte) ? matteReason : null) })).filter(i => i.message);
  const matteNeeded = !matteUnavailable && needsPresenterMask(settings, catalog?.effects ?? [], data?.timeline);
  const natPreviewBlocked = !compare && natMask && !source?.mask;
  const assetKey = settings.effects.map(e => e.asset ?? '').join('|');
  const video = useRef<HTMLVideoElement>(null), side = useRef<HTMLDivElement>(null);
  const displaySettings = useMemo(() => compare ? { ...blank, motion: 'balanced' } : settings, [settings, compare]);
  const previewEffects = useMemo(() => source ? livePlan(source, settings, project.id, location.origin).effects as Effect[] : [], [source, settings, project.id]);
  const onScreenEffects = activeEffectsAtTime(previewEffects, time);
  const selectPanel = (p: Panel) => { setPanel(p); setFocus(false); side.current?.scrollTo({ top: 0 }); };
  const jump = (value: number) => { const t = clampTime(value, duration); setTime(t); setSeek(s => ({ time: t, id: s.id + 1 })); setPreviewMode('live'); };
  const seekPlayback = (value: number) => {
    if (previewMode === 'rendered' && video.current) { const t = clampTime(value, activeDuration); video.current.currentTime = t; setTime(t); }
    else jump(value);
  };
  const watchRendered = () => { setPreviewMode('rendered'); setCompare(false); setTime(0); setRenderedDuration(0); setPlayback(p => ({ ...p, playing: false })); };
  const control = (action: 'play' | 'mute') => {
    if (previewMode === 'rendered' && video.current) {
      if (action === 'play') { if (video.current.paused) void video.current.play().catch(() => {}); else video.current.pause(); }
      else video.current.muted = !video.current.muted;
    } else setTransport(t => ({ action, id: t.id + 1 }));
  };
  const edited = () => { editGeneration.current++; setPreviewMode('live'); setCompare(false); setNotice(''); setErr(''); setDismissedEffect(null); };
  const set = (p: Partial<Settings>, group = '') => {
    const now = Date.now();
    const next = changeHistory(historyRef.current, { ...historyRef.current.present, ...p }, !!group && group === lastEdit.current.key && now - lastEdit.current.time < 700);
    lastEdit.current = { key: group, time: now }; historyRef.current = next; setHistory(next); edited();
  };
  const patch = (id: string, p: Partial<Effect>, group = '') => set({ effects: historyRef.current.present.effects.map(e => e.id === id ? { ...e, ...p } : e) }, group);
  const patchNat = (patch: Partial<BrandNat>, group = '') => {
    const current = historyRef.current.present;
    set({ brandNat: resolveBrandNat(current.preset, { ...current.brandNat, ...patch }) }, group);
  };
  const travel = (dir: 'undo' | 'redo') => { const next = travelHistory(historyRef.current, dir); historyRef.current = next; setHistory(next); lastEdit.current.key = ''; edited(); };
  const chooseEffect = (e: Effect) => { setSelected(e.id); selectPanel('effects'); jump(Math.min(e.at + .4, e.at + e.duration / 2)); };
  const anchorFor = (t: number) => {
    const seg = data?.timeline.segments.find((s: any) => t >= s.t && t < s.e);
    if (!seg?.src) return undefined;
    const sourceTime = seg.ss + t - seg.t;
    return { source: seg.src, time: sourceTime, occurrence: data.timeline.segments.filter((s: any) => s.src === seg.src && s.ss <= sourceTime && sourceTime < s.se && s.t < seg.t).length };
  };
  const place = (id: string, t: number) => {
    const start = Math.max(0, Math.min(t || 0, duration - .1));
    const row = historyRef.current.present.effects.find(e => e.id === id)!;
    patch(id, { at: start, anchor: anchorFor(start), duration: Math.min(row.duration, duration - start) }); jump(start + .1);
  };
  const add = (k: Kind) => {
    if (k.matte && matteUnavailable) return;
    let start = Math.min(time, Math.max(0, duration - .1)), length = Math.min(2.5, duration - start);
    if (k.id === 'zoom-through-cut' && boundaries.length) {
      const next = [...boundaries].sort((a: number, b: number) => Math.abs(a - time) - Math.abs(b - time))[0];
      start = Math.max(0, next - .5); length = Math.min(1, duration - start);
    }
    const e: Effect = { id: crypto.randomUUID(), type: k.id, at: start, duration: length, strength: 1, enabled: true, text: '', items: [], values: [], anchor: anchorFor(start) };
    if (k.id === 'text-behind-person') {
      e.textSize = .16; e.textY = .3;
      e.text = (source?.words ?? []).filter((w: any) => w.end > start && w.start < start + length).slice(0, 3).map((w: any) => w.text).join(' ');
    }
    set({ effects: [...historyRef.current.present.effects, e] }); chooseEffect(e);
  };

  useEffect(() => { api.get('/api/visuals/catalog').then(setCatalog).catch(e => setErr(e.message)); }, []);
  useEffect(() => {
    let live = true;
    setDismissedEffect(null); setData(null); setSource(null); setSourceError(''); setPreviewMode('live'); setCompare(false); setErr(''); setSelected(null); setJob(null); setResult(null); setExported(null); setTime(.8); setSeek({ time: .8, id: 0 }); setNotice(''); setApply(false);
    if (version) api.get(`/api/projects/${project.id}/versions/${version}/visuals`).then(d => {
      if (!live) return;
      const current = settingsOf(d.config), draft = recoverDraft(storage.get(draftKey), d.config.rev ?? 0, d.timelineRev);
      const initial = draft ? settingsOf(draft) : current;
      const next = draft && !same(initial, current) ? changeHistory(historyOf(current), initial) : historyOf(current);
      historyRef.current = next; setHistory(next); setSaved(current); setData({ ...d, scope });
      if (draft && !same(initial, current)) setNotice('Your unfinished edits were restored.');
      if (d.result) { setResult({ ...d.result, stamp: Date.now() }); if (!d.result.preview) setExported(d.result); }
      if (d.job) setJob(d.job);
    }).catch(e => { if (live) setErr(e.message); });
    return () => { live = false; };
  }, [project.id, version]);
  useEffect(() => {
    if (data?.scope === scope) storage.put(draftKey, !same(settings, saved) ? { rev: data.config.rev ?? 0, timelineRev: data.timelineRev, settings } : null);
  }, [data, settings, saved, draftKey]);
  useEffect(() => {
    if (!job || job.state !== 'running') return;
    let live = true;
    const timer = setInterval(() => api.get(`/api/visual-jobs/${job.id}`).then(j => {
      if (!live) return;
      setJob(j);
      if (j.state === 'done') {
        setResult({ ...j, stamp: Date.now() });
        if (!j.preview) setExported(j);
        if (renderGenerations.current[j.id] === editGeneration.current) { watchRendered(); selectPanel('export'); }
      }
      if (j.state === 'failed') setErr(j.message || 'The render could not finish. Try again.');
    }).catch(e => { if (live) setErr(e.message); }), 1000);
    return () => { live = false; clearInterval(timer); };
  }, [job?.id, job?.state]);
  useEffect(() => {
    if (!data) return;
    let live = true; setPreparing(true); setSourceError('');
    api.get(`/api/projects/${project.id}/versions/${version}/visual-source${matteNeeded ? '?matte=1' : ''}`).then(d => {
      if (live) { setSource(d.plan); setPreparing(false); }
    }).catch(e => { if (live) { setSourceError(e.message); setPreparing(false); } });
    return () => { live = false; };
  }, [project.id, version, data?.timelineRev, matteNeeded, assetKey, retry]);

  const save = async (): Promise<number | null> => {
    if (!data || uploading) return null;
    if (natIssue) { setErr(natIssue); selectPanel('style'); return null; }
    if (issues.length) { setErr('Finish the highlighted effects before saving, or switch them off.'); const e = settings.effects.find(e => e.id === issues[0].id); if (e) chooseEffect(e); return null; }
    setBusy(true); setErr(''); const generation = editGeneration.current, requestScope = scope;
    try {
      const clean = { ...settings, effects: settings.effects.map(e => ({ ...e, items: e.items.map(x => x.trim()).filter(Boolean) })) };
      const r = await api.post(`/api/projects/${project.id}/versions/${version}/visuals`, { rev: data.config.rev ?? 0, timelineRev: data.timelineRev, settings: clean, applyToProject: apply });
      if (scopeRef.current !== requestScope) return null;
      setData({ ...data, config: r.config }); setSaved(settingsOf(r.config));
      if (generation === editGeneration.current) { const next = { ...historyRef.current, present: settingsOf(r.config) }; historyRef.current = next; setHistory(next); }
      setApply(false); setNotice('Style and effects saved'); return r.config.rev;
    } catch (e) { if (scopeRef.current === requestScope) setErr((e as Error).message); return null; }
    finally { setBusy(false); }
  };
  const render = async (preview: boolean) => {
    if (natIssue) { setErr(natIssue); selectPanel('style'); return; }
    const pendingMessage = captionEditMessage(captionEditsRef.current);
    if (!preview && pendingMessage) { setErr(pendingMessage); selectPanel('captions'); return; }
    const generation = editGeneration.current, requestScope = scope;
    const rev = dirty || !data?.config.rev ? await save() : data.config.rev;
    if (rev == null || scopeRef.current !== requestScope) return;
    setErr(''); setBusy(true);
    try {
      if (!preview) {
        // Check again after saving, including changes sent from another tab.
        // A batch waiting for the agent is still missing from this rendered cut.
        const current = captionEditState(await api.get('/api/desk'), project.id);
        const message = captionEditMessage(captionEditsRef.current) || captionEditMessage(current);
        if (message) { setErr(message); selectPanel('captions'); return; }
        if (scopeRef.current !== requestScope) return;
      }
      const j = await api.post(`/api/projects/${project.id}/versions/${version}/visual-render`, { rev, preview, at: Math.min(time, Math.max(0, duration - .1)) });
      renderGenerations.current[j.id] = generation; if (scopeRef.current === requestScope) setJob(j);
    } catch (e) { if (scopeRef.current === requestScope) setErr((e as Error).message); }
    finally { setBusy(false); }
  };
  const commands = useRef({ save, travel }); commands.current = { save, travel };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      if (e.key.toLowerCase() === 's') { e.preventDefault(); if (!busy && dirty) void commands.current.save(); }
      if ((e.target as HTMLElement)?.closest('input,textarea,select,[contenteditable="true"]')) return;
      if (e.key.toLowerCase() === 'z') { e.preventDefault(); commands.current.travel(e.shiftKey ? 'redo' : 'undo'); }
    };
    addEventListener('keydown', key); return () => removeEventListener('keydown', key);
  }, [busy, dirty]);

  if (!cuts.length) return <div class="empty vs-empty"><span class="label">Style & export</span><h2>Your video comes first.</h2><p>Bring in your footage and create a cut. Then try a style, add effects and export it here.</p><a class="btn primary" href="#review">Go to review</a><a class="btn ghost" href="#inbox">Add footage</a></div>;
  const style = [...(catalog?.styles ?? []), ...(catalog?.legacyStyles ?? [])].find(s => s.id === settings.preset);
  const retiredStyle = catalog?.legacyStyles?.some(s => s.id === settings.preset);
  const styleCard = (s: Style) => <button key={s.id} class={'vs-style' + (settings.preset === s.id ? ' chosen' : '')} aria-label={`${s.name} · ${s.summary}`} aria-pressed={settings.preset === s.id} onClick={() => {
    if (settings.preset !== s.id) {
      set({ preset: s.id, accent: s.accent, brandNat: resolveBrandNat(s.id, s.brandNat) });
      if (s.brandNat) jump(1.2);
    }
  }}>
    <span class="vs-style-art" style={{ background: s.background, '--vs-colour': s.accent, aspectRatio: `${data?.timeline.width}/${data?.timeline.height}` } as any}>
      {source ? <StylePreview source={source} preset={s.id} accent={s.accent} brandNat={s.brandNat} project={project.id}/> : <span class="vs-thumb-loading">{s.name}</span>}
      <span class="vs-style-check"><StudioIcon name="check"/></span>
    </span>
    <span class="vs-style-title"><strong>{s.name}</strong><span class="vs-style-dot" style={{ background: s.accent }}/></span>
    <span class="vs-style-description">{({ volt: 'Bold & electric', ledger: 'Quiet editorial', sketch: 'Hand-drawn', terminal: 'Retro digital', glass: 'Soft & luminous', pop: 'Playful & punchy', 'nat-editorial': 'Serif & staircase', 'nat-warm': 'Warm highlights', 'nat-clean': 'Clean keyword pills', 'nat-scrapbook': 'Handwritten & blue', 'nat-bold': 'Bold words & yellow' } as Record<string, string>)[s.id] ?? s.summary}</span>
  </button>;
  const natSelect = (field: NatControl, label: string) => {
    if (!nat || !catalog?.brandNat) return null;
    const options = catalog.brandNat.options[field], active = options.find(o => o.code === nat[field]);
    return <label class="field vs-nat-field" key={field}><span class="vs-nat-label">{label}</span>
      <select aria-label={label} aria-describedby={`nat-${field}-help`} value={nat[field]} onChange={e => {
        patchNat({ [field]: e.currentTarget.value } as Partial<BrandNat>);
        if (field === 'hook') jump(1.2);
      }}>{options.map(o => <option key={o.code} value={o.code} disabled={o.matte && matteUnavailable}>{o.name}{o.matte ? ' · Mac cutout' : ''}</option>)}</select>
      <span class="fine" id={`nat-${field}-help`}>{active?.description}</span>
    </label>;
  };
  const ordered = catalog?.effects.filter(k => !k.pickerHidden && (filter === 'All' || k.group === filter) && `${k.name} ${k.description}`.toLowerCase().includes(search.toLowerCase().trim())) ?? [];
  const nameOf = (type: string) => {
    const family = catalog?.effects.find(k => k.variants?.some(v => v.type === type));
    return family ? `${family.name} · ${family.variants?.find(v => v.type === type)?.name}` : catalog?.effects.find(k => k.id === type)?.name ?? type;
  };
  const dismissEffect = (e: Effect) => { patch(e.id, { enabled: false }); setDismissedEffect(nameOf(e.type)); };
  const undoDismissal = () => { travel('undo'); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.vs-preview-effects .vs-effect-off')?.focus()); };
  const discard = () => { set({ ...structuredClone(saved) }); setApply(false); setSelected(null); setNotice('Returned to saved settings. Undo to bring back your edits.'); };
  const staleExport = exported && (captionMessage || dirty || exported.revision !== data?.config.rev || exported.timelineRev !== data?.timelineRev);
  return <div class={'visual-studio' + (focus ? ' vs-focus' : '')} aria-label="Styles and effects">
    <header class="vs-heading">
      <div class="vs-title"><h1>Style your video<span>.</span></h1></div>
      <label class="vs-cut-label"><span class="sr">Cut</span><select aria-label="Cut for styles and effects" value={version} disabled={busy || uploading} onChange={e => setVersion(e.currentTarget.value)}>{cuts.map((c: any) => <option key={c.version} value={c.version}>{c.version} · {tc(c.duration)}{c.version.includes('.s') ? ' · Short' : ''}</option>)}</select></label>
      <span class="spacer"/>
      <div class="vs-history"><button class="vs-icon-btn" title="Undo (⌘/Ctrl Z)" aria-label="Undo edit" disabled={!history.past.length || !data} onClick={() => travel('undo')}><StudioIcon name="undo"/></button><button class="vs-icon-btn" title="Redo (⌘/Ctrl Shift Z)" aria-label="Redo edit" disabled={!history.future.length || !data} onClick={() => travel('redo')}><StudioIcon name="redo"/></button></div>
      <span class={'vs-save-state' + (dirty || captionMessage ? ' is-dirty' : '')}><StudioIcon name={dirty || captionMessage ? 'dot' : 'check'}/>{captionMessage ? 'Caption changes pending' : dirty ? 'Unsaved style changes' : 'Style and effects saved'}</span>
      <button class="btn vs-save" disabled={busy || uploading || !dirty} onClick={() => save()}>Save</button>
      <button class="btn primary vs-export" disabled={busy || rendering || uploading || !data || !!captionMessage} title={captionMessage ?? undefined} aria-describedby={captionMessage ? 'vs-caption-pending' : undefined} onClick={() => render(false)}>{rendering ? 'Exporting…' : 'Export video'}<StudioIcon name="export"/></button>
    </header>
    {err && <div class="vs-error" role="alert"><span>{err}</span><button class="vs-icon-btn" aria-label="Dismiss error" onClick={() => setErr('')}>×</button></div>}
    {!data || !catalog ? <div class="empty vs-empty" role="status">{err ? 'The editor could not load this cut.' : 'Opening your video…'}</div> : <div class="vs-workspace">
      <section class="vs-preview" aria-label="Video workspace">
        <div class="vs-stagebar"><span class="vs-live-label"><span class="dot"/>{previewMode === 'rendered' ? (result?.preview ? 'Rendered preview' : 'Exported video') : compare ? 'Original cut' : 'Live preview'}</span><span class="vs-stage-meta">{data.timeline.width} × {data.timeline.height}</span><span class="spacer"/>
          <button class="vs-stage-btn" aria-pressed={compare} disabled={previewMode !== 'live' || !source} onClick={() => setCompare(!compare)}><StudioIcon name="compare"/>{compare ? 'Back to edit' : 'Original'}</button>
          <button class="vs-stage-btn" aria-pressed={focus} onClick={() => setFocus(!focus)}><StudioIcon name={focus ? 'minimize' : 'expand'}/>{focus ? 'Show tools' : 'Focus'}</button>
        </div>
        {!compare && settings.effects.length > 0 && <div class="vs-preview-effects" role="group" aria-label="Effects in this frame">
          {previewMode === 'rendered' ? <><span class="vs-effects-context">Rendered video</span><button class="vs-text-btn" onClick={() => { jump(time); selectPanel('effects'); }}>Edit effects<StudioIcon name="arrow"/></button></> : <>
            <span class="vs-effects-context">Video effects</span>
            <span class="sr" id="vs-effect-dismiss-help">Turn off an effect to remove it from your preview and next export. You can undo this change.</span>
            <div class="vs-preview-effect-list">
              {onScreenEffects.map(e => <span key={e.id} class="vs-preview-effect"><button class="vs-effect-edit" aria-label={`Edit ${nameOf(e.type)} effect`} onClick={() => chooseEffect(e)}>{nameOf(e.type)}</button><button class="vs-effect-off" aria-label={`Turn off ${nameOf(e.type)} effect`} aria-describedby="vs-effect-dismiss-help" title={`Turn off ${nameOf(e.type)} in your video`} onClick={() => { dismissEffect(e); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.vs-dismiss-undo')?.focus()); }}><StudioIcon name="close"/></button></span>)}
              {dismissedEffect ? <span class="vs-effect-dismissed"><span role="status">{dismissedEffect} off</span><button class="vs-text-btn vs-dismiss-undo" onClick={undoDismissal}>Undo</button></span> : !onScreenEffects.length && <span class="vs-effects-empty">None at this moment</span>}
            </div>
          </>}
        </div>}
        <div class="vs-stage" style={{ '--video-ratio': data.timeline.width / data.timeline.height } as any}>
          <div class="vs-player" style={{ aspectRatio: `${data.timeline.width}/${data.timeline.height}` }}>
            {previewMode === 'live' ? source && !natPreviewBlocked ? <LivePreview source={source} settings={displaySettings} project={project.id} seek={seek} onTime={setTime} transport={transport} onPlayback={setPlayback} onReady={setPreviewReady} onCommand={command => command === 'save' ? (!busy && dirty && void save()) : travel(command)}/> : <div class="vs-loading" role="status"><span class="vs-loading-icon">▷</span><b>{sourceError || natIssue ? 'Preview unavailable' : natPreviewBlocked ? 'Preparing your cutout' : 'Preparing your video'}</b><p>{natIssue || sourceError || (natPreviewBlocked ? 'Separating you from the background on this Mac. Your video stays here.' : 'You can choose a style while this loads.')}</p>{sourceError && !natIssue && <button class="btn" onClick={() => setRetry(r => r + 1)}>Try again</button>}</div> : result?.file ? <video ref={video} key={result.stamp} playsInline muted={playback.muted} onLoadedMetadata={e => setRenderedDuration(e.currentTarget.duration)} onTimeUpdate={e => setTime(e.currentTarget.currentTime)} onPlay={() => setPlayback(p => ({ ...p, playing: true }))} onPause={() => setPlayback(p => ({ ...p, playing: false }))} onVolumeChange={e => setPlayback(p => ({ ...p, muted: e.currentTarget.muted }))} src={media(project.id, result.file) + '?v=' + result.stamp}/> : null}
          </div>
          {compare && <span class="vs-before-badge">ORIGINAL</span>}
          {preparing && source && <span class="vs-preparing" role="status">Preparing presenter or media…</span>}
        </div>
        <div class="vs-transport">
          <div class="vs-playback-controls">
            <button class="vs-icon-btn" aria-label="Back 5 seconds" title="Back 5 seconds" onClick={() => seekPlayback(time - 5)}><StudioIcon name="back"/></button>
            <button class="vs-play-btn" disabled={previewMode === 'live' && (!previewReady || natPreviewBlocked)} aria-label={playback.playing ? 'Pause video' : 'Play video'} title="Play / pause" onClick={() => control('play')}><StudioIcon name={playback.playing ? 'pause' : 'play'}/></button>
            <button class="vs-icon-btn" aria-label="Forward 5 seconds" title="Forward 5 seconds" onClick={() => seekPlayback(time + 5)}><StudioIcon name="forward"/></button>
            <span class="vs-time"><b>{tcLong(time)}</b><span>/ {tc(activeDuration)}</span></span>
            <button class="vs-icon-btn vs-mute" aria-label={playback.muted ? 'Unmute video' : 'Mute video'} title={playback.muted ? 'Unmute' : 'Mute'} onClick={() => control('mute')}><StudioIcon name={playback.muted ? 'muted' : 'volume'}/></button>
          </div>
          <div class="vs-timing-actions">
            {previewMode === 'rendered' ? <button class="btn" onClick={() => jump(time)}>Back to live preview</button> : <>
            <button class="vs-stage-btn" aria-expanded={timing} aria-controls="effect-timing" onClick={() => setTiming(!timing)}><StudioIcon name="timeline"/>{timing ? 'Hide timing' : 'Show timing'}</button>
            <button class="btn vs-add-effect" onClick={() => { setSelected(null); selectPanel('effects'); }}><StudioIcon name="plus"/>Add effect</button></>}
          </div>
        </div>
        <EditTimeline description={previewMode === "rendered" ? "Rendered video" : undefined} expanded={previewMode === 'live' && !focus && timing} key={scope} duration={activeDuration} time={time} fps={source?.fps ?? 30} effects={previewMode === 'live' ? settings.effects : []} boundaries={previewMode === 'live' ? boundaries : []} selected={selected} nameOf={nameOf} onSeek={seekPlayback} onSelect={chooseEffect} onAdd={() => selectPanel('effects')}/>
        <div class={"vs-status" + (sourceError || captionMessage || rendering || notice || compare || issues.length ? " has-message" : "")} role="status"><span>{sourceError || captionMessage || (rendering ? 'Rendering your video. You can keep editing.' : notice || (compare ? 'Original cut. Your edits are kept.' : issues.length ? `${issues.length} effect${issues.length > 1 ? 's need' : ' needs'} content. Select an effect to finish it.` : 'Style and effect changes appear live.'))}</span>{result?.file && <button class="vs-text-btn" onClick={() => { if (previewMode === 'live') watchRendered(); else jump(time); }}>{previewMode === 'live' ? 'Watch last render' : 'Back to live preview'}<StudioIcon name="arrow"/></button>}</div>
      </section>
      <aside class="vs-inspector" aria-label="Editing tools">
        <div class="vs-tabs" role="tablist" aria-label="Editing tools">{(['style', 'effects', 'captions', 'export'] as Panel[]).map(p => <button id={`vs-tab-${p}`} role="tab" aria-selected={panel === p} aria-controls={`vs-panel-${p}`} tabIndex={panel === p ? 0 : -1} onKeyDown={e => {
          const tabs: Panel[] = ['style', 'effects', 'captions', 'export']; const i = tabs.indexOf(p);
          const next = e.key === 'ArrowRight' ? (i + 1) % 4 : e.key === 'ArrowLeft' ? (i + 3) % 4 : e.key === 'Home' ? 0 : e.key === 'End' ? 3 : -1;
          if (next >= 0) { e.preventDefault(); selectPanel(tabs[next]); document.getElementById(`vs-tab-${tabs[next]}`)?.focus(); }
        }} onClick={() => selectPanel(p)}>{({ style: 'Style', effects: 'Effects', captions: 'Captions', export: 'Export' })[p]}{p === 'effects' && settings.effects.length > 0 && <span>{settings.effects.length}</span>}</button>)}</div>
        <div class="vs-sidebar-body" ref={side} role="tabpanel" id={`vs-panel-${panel}`} aria-labelledby={`vs-tab-${panel}`}>
          {captionMessage && <div class="vs-input-hint" id="vs-caption-pending" role="status"><p>{captionMessage}</p>{captionEdits.queued || captionEdits.saving ? panel !== 'captions' && <button class="btn small" onClick={() => selectPanel('captions')}>Review caption changes</button> : <a class="btn small" href="#review">Review updated cut</a>}</div>}
          {panel === 'style' && <>
            <div class="vs-section-intro"><span class="label">Your video. Your signature.</span><h2>Find your <em>look.</em></h2><p>Distinct looks, previewed on your own video.</p></div>
            <button class={'vs-original' + (settings.preset === 'original' ? ' chosen' : '')} aria-label="Original · Keep your current look" aria-pressed={settings.preset === 'original'} onClick={() => { if (settings.preset !== 'original') set({ preset: 'original', accent: undefined, brandNat: undefined }); }}><StudioIcon name="film"/><span><strong>Original</strong><small>Keep your current look</small></span><StudioIcon name={settings.preset === 'original' ? 'check' : 'arrow'}/></button>
            <div class="vs-styles" role="group" aria-label="Yap Machine looks">{catalog.styles.map(styleCard)}</div>
            {retiredStyle && <p class="vs-saved-look"><strong>{style?.name} · Saved look</strong><span>Your existing look is preserved. Choose one above when you want a fresh starting point.</span></p>}
            {nat && catalog.brandNat && <section class="vs-nat-customise" aria-labelledby="vs-nat-customise-heading">
              <div class="vs-nat-heading"><div><span class="label">Make it yours</span><h3 id="vs-nat-customise-heading">{style?.name ?? 'Your look'}</h3></div><button class="btn ghost small" onClick={() => { set({ brandNat: resolveBrandNat(settings.preset, style?.brandNat), accent: style?.accent }); jump(1.2); }}>Reset look</button></div>
              {natSelect('caption', 'Captions')}
              {['C1', 'C4', 'C5', 'C6', 'C7', 'C9'].includes(nat.caption) && <label class="field">Emphasise words<input aria-label="Emphasise words" maxLength={160} value={nat.emphasis ?? ''} placeholder="For example: idea, story, useful" onInput={e => patchNat({ emphasis: e.currentTarget.value }, 'emphasis')}/><span class="fine">Separate words with commas. Each gets the highlighted beat as you say it. Leave blank to use the end of each phrase.</span></label>}
              {natSelect('hook', 'Opening title')}
              {nat.hook !== 'none' && <div class="vs-nat-copy">
                <label class="field">Your headline<input aria-label="Your headline" maxLength={120} value={nat.title} placeholder="Use the opening words from your video" onFocus={() => { if (time >= 3) jump(1.2); }} onInput={e => patchNat({ title: e.currentTarget.value }, 'nat-title')}/></label>
                <label class="field">Supporting line<input aria-label="Supporting line" maxLength={100} value={nat.subtitle} placeholder="Use the next words from your video" onFocus={() => { if (time >= 3) jump(1.2); }} onInput={e => patchNat({ subtitle: e.currentTarget.value }, 'nat-subtitle')}/></label>
                <span class="fine">Leave either line empty to use your spoken words. The title opens your video for up to three seconds.</span>
                <button class="btn ghost small" onClick={() => jump(1.2)}>Preview the opening<StudioIcon name="play"/></button>
              </div>}
              {natSelect('layout', 'Layout')}{natSelect('finish', 'Finish')}{natSelect('position', 'Text placement')}
              {matteUnavailable && <p class="fine vs-nat-matte" role="status">{natIssue || `${matteReason} Choices that need a presenter cutout are unavailable here.`}</p>}
              {natMask && !matteUnavailable && <p class="fine vs-nat-matte" role="status">{sourceError || (preparing || !source?.mask ? 'Preparing a real presenter cutout on this Mac…' : 'Presenter cutout ready for preview and export.')}</p>}
            </section>}
            <details class="vs-customise"><summary><span><StudioIcon name="sliders"/>Fine-tune your style</span><StudioIcon name="chevron"/></summary><div class="vs-customise-body">
              <div class="vs-toolbar"><label>Motion<select aria-label="Motion strength" value={settings.motion} onChange={e => set({ motion: e.currentTarget.value })}><option value="subtle">Subtle</option><option value="balanced">Balanced</option><option value="bold">Bold</option></select></label><label>Accent<input aria-label="Style accent" type="color" value={settings.accent ?? style?.accent ?? '#F0412B'} onInput={e => set({ accent: e.currentTarget.value }, 'accent')}/></label></div>
              {nat && <div class="field"><label class="vs-default"><input type="checkbox" checked={nat.subjectOverlap === true} aria-describedby="vs-subject-overlap-help" disabled={!nat.subjectOverlap && (!topPanel || matteUnavailable)} onChange={e => patchNat({ subjectOverlap: e.currentTarget.checked })}/> Speaker overlaps title panel</label><span class="fine" id="vs-subject-overlap-help">{!topPanel ? 'Choose Title space or More text space on a portrait or square video. Overlap is inactive in full-frame and wide side-panel layouts.' : matteUnavailable ? matteReason : 'Let the speaker overlap the title panel when the framing allows it. Uses a real presenter cutout on this Mac.'}</span></div>}
              <label class="vs-default"><input type="checkbox" checked={apply} onChange={e => setApply(e.currentTarget.checked)}/> Use this style for new cuts</label>
            </div></details>
          </>}
          {panel === 'effects' && <>
            {effect && kind ? <div class="vs-effect-editor" key={effect.id}>
              <button class="btn ghost small vs-back" onClick={() => setSelected(null)}>← All effects</button><div class="row between"><h2>{effectFamily?.name ?? kind.name}</h2><label class="vs-enable"><input type="checkbox" checked={effect.enabled} onChange={e => patch(effect.id, { enabled: e.currentTarget.checked })}/> On</label></div><p class="muted small">{kind.description}</p>
              {effectFamily?.variants && <label class="field">Presentation<select aria-label="Effect presentation" value={effect.type} onChange={e => patch(effect.id, { type: e.currentTarget.value })}>{effectFamily.variants.map(v => <option key={v.type} value={v.type}>{v.name}</option>)}</select><span class="fine">Your text, timing and steps stay in place when you switch.</span></label>}
              {effectIssue(effect, duration, boundaries) && <p class="vs-input-hint" role="status">{effectIssue(effect, duration, boundaries)}</p>}
              <div class="grid2"><label class="field">Start · seconds<input type="number" aria-label="Effect start" step="0.1" min="0" max={Math.max(0, duration - .1)} value={Number(effect.at.toFixed(2))} onChange={e => place(effect.id, Number(e.currentTarget.value))}/></label><label class="field">Duration · seconds<input type="number" aria-label="Effect duration" step="0.1" min="0.1" max={Math.min(60, duration - effect.at)} value={Number(effect.duration.toFixed(2))} onChange={e => patch(effect.id, { duration: Number(e.currentTarget.value) })}/></label></div>
              <div class="row"><button class="btn small" onClick={() => place(effect.id, time)}>Start at playhead</button><button class="btn ghost small" onClick={() => jump(effect.at + Math.min(.5, effect.duration / 2))}>Preview effect</button></div>
              <label class="field">Place on a spoken line<select aria-label="Place effect on a transcript line" value="" onChange={e => { if (e.currentTarget.value !== '') place(effect.id, Number(e.currentTarget.value)); }}><option value="">Choose a line…</option>{data.timeline.segments.map((s: any, i: number) => <option key={i} value={s.t}>{tc(s.t)} · {s.text?.slice(0, 85) || s.beat || 'Cut'}</option>)}</select></label>
              <label class="field">{effect.type === 'text-behind-person' ? 'Words behind you' : effect.type === 'count-up' ? 'Number label' : 'Heading'}<input aria-label="Effect text" maxLength={180} value={effect.text} placeholder={effect.type === 'magazine-cover' ? 'Your magazine title' : effect.type === 'text-behind-person' ? 'Your headline' : effect.type === 'count-up' ? 'What does this number mean?' : 'Optional heading'} onInput={e => patch(effect.id, { text: e.currentTarget.value }, `text:${effect.id}`)}/></label>
              {effect.type === 'text-behind-person' && <>
                <label class="field">Text size <span class="mono fine">{Math.round((effect.textSize ?? .16) * 100)}%</span><input type="range" aria-label="Behind-you text size" min="0.06" max="0.3" step="0.01" value={effect.textSize ?? .16} onInput={e => patch(effect.id, { textSize: Number(e.currentTarget.value) }, `textSize:${effect.id}`)}/></label>
                <label class="field">Vertical position <span class="mono fine">{Math.round((effect.textY ?? .3) * 100)}%</span><input type="range" aria-label="Behind-you text vertical position" min="0.1" max="0.85" step="0.01" value={effect.textY ?? .3} onInput={e => patch(effect.id, { textY: Number(e.currentTarget.value) }, `textY:${effect.id}`)}/><span class="fine">Move the headline across your shoulders or behind your head. Your room stays in the picture.</span></label>
              </>}
              {effect.type === 'count-up' && <div class="grid2">{(['Start number', 'Final total'] as const).map((label, index) => <label class="field" key={label}>{label}<input type="number" step="any" min="-1000000000000" max="1000000000000" aria-label={label} value={Number.isFinite(effect.values[index]) ? effect.values[index] : ''} placeholder={index === 0 ? '0' : 'Your total'} onInput={e => {
                const values = [effect.values[0] ?? NaN, effect.values[1] ?? NaN]; values[index] = e.currentTarget.value.trim() ? Number(e.currentTarget.value) : NaN;
                patch(effect.id, { values }, `count:${effect.id}:${index}`);
              }}/></label>)}</div>}
              {['checklist', 'checklist-pop', 'headline-storm', 'magazine-cover'].includes(effect.type) && <label class="field">{effect.type === 'headline-storm' ? 'Headlines' : 'Items'} · one per line<textarea aria-label="Effect items" rows={4} value={effect.items.join('\n')} placeholder="Add your own words…" onInput={e => patch(effect.id, { items: e.currentTarget.value.split('\n') }, `items:${effect.id}`)}/></label>}
              {effect.type === 'growth-curve' && <label class="field">Chart values<input aria-label="Growth curve values" defaultValue={effect.values.join(', ')} placeholder="12, 18, 31, 45" onInput={e => patch(effect.id, { values: e.currentTarget.value.split(',').map(v => v.trim() ? Number(v.trim()) : NaN) }, `values:${effect.id}`)}/><span class="fine">Separate numbers with commas.</span></label>}
              {kind.asset && <label class="field vs-asset">{effect.type === 'green-screen' ? 'Background image or video' : 'Supporting image or video'}<input type="file" aria-label="Effect image or video" disabled={uploading} accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm" onChange={async e => {
                const file = e.currentTarget.files?.[0]; if (!file) return;
                if (file.size > 200 * 1024 * 1024) { setErr('Choose an image or video under 200 MB.'); return; }
                const form = new FormData(); form.append('file', file); const requestScope = scope, id = effect.id; setUploading(true);
                try { const r = await api.post(`/api/projects/${project.id}/visual-assets`, form); if (scopeRef.current === requestScope) patch(id, { asset: r.asset }); }
                catch (x) { if (scopeRef.current === requestScope) setErr((x as Error).message); }
                finally { setUploading(false); }
              }}/><span class="fine">{uploading ? 'Adding your media…' : effect.asset ? 'Media added. Choose another file to replace it.' : 'Image or video · up to 200 MB'}</span></label>}
              {['snap-zoom', 'dolly-zoom', 'liquid-glass', 'digital-zoom', 'zoom-through-cut'].includes(effect.type) && <label class="field">Strength <span class="mono fine">{effect.strength.toFixed(2)}×</span><input type="range" aria-label="Effect strength" min="0.25" max="2" step="0.05" value={effect.strength} onInput={e => patch(effect.id, { strength: Number(e.currentTarget.value) }, `strength:${effect.id}`)}/></label>}
              {kind.matte && <p class="fine" role="status">{matteUnavailable ? matteReason : sourceError ? sourceError : preparing ? 'Separating you from the background on this Mac… Your video stays here.' : source?.mask ? 'Presenter cutout ready. Fine-tune the effect in the live preview.' : 'Uses macOS 12+ person segmentation and Apple’s Command Line Tools. The first preview can take a moment.'}</p>}
              <button class="btn vs-remove" onClick={() => { set({ effects: settings.effects.filter(e => e.id !== effect.id) }); setSelected(null); }}>Remove effect</button>
            </div> : <>
              <div class="vs-section-intro"><span class="label">Make a moment</span><h2>Add a little emphasis.</h2><p class="muted small">Effects start at the playhead: <b class="mono">{tcLong(time)}</b>.</p></div>
              {settings.effects.length > 0 && <div class="vs-effect-list"><h3>In your video <span class="faint">{settings.effects.length}</span></h3>{settings.effects.map((e, i) => <div class="vs-effect-row" key={e.id}><input type="checkbox" aria-label={`Enable ${nameOf(e.type)}`} checked={e.enabled} onChange={ev => patch(e.id, { enabled: ev.currentTarget.checked })}/><button class="vs-effect-select" onClick={() => chooseEffect(e)}><b>{nameOf(e.type)}</b><span class={'fine' + (effectIssue(e, duration, boundaries) ? ' vs-needs' : '')}>{effectIssue(e, duration, boundaries) ? 'Needs content' : `${tcLong(e.at)} · ${e.duration.toFixed(1)} s`}</span></button><button class="vs-mini" aria-label={`Move ${nameOf(e.type)} earlier in stack`} disabled={i === 0} onClick={() => { const rows = [...settings.effects]; [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]]; set({ effects: rows }); }}>↑</button><button class="vs-mini" aria-label={`Remove ${nameOf(e.type)}`} onClick={() => set({ effects: settings.effects.filter(x => x.id !== e.id) })}>×</button></div>)}</div>}
              <label class="vs-search"><span class="sr">Search effects</span><input type="search" aria-label="Search effects" placeholder="Search effects…" value={search} onInput={e => setSearch(e.currentTarget.value)}/></label>
              <div class="vs-filters" role="group" aria-label="Effect groups">{['All', 'Emphasis', 'Explain', 'Layouts', 'Motion', 'Transform'].map(g => <button aria-pressed={filter === g} onClick={() => setFilter(g)}>{g}</button>)}</div>
              {matteUnavailable && ordered.some(k => k.matte) && <p class="fine" role="status">{matteReason}</p>}
              <div class="vs-effect-cards">{ordered.map(k => <button key={k.id} class="vs-effect-card" aria-label={`Add ${k.name}`} disabled={k.matte && matteUnavailable} onClick={() => add(k)}><span class={'vs-effect-icon fx-' + k.id} aria-hidden="true">{({ Emphasis: '✦', Explain: '☑', Layouts: '▣', Motion: '↗', Transform: '◈' } as Record<string, string>)[k.group]}</span><strong>{k.name}</strong><span class="small muted">{k.description}</span><span class="vs-effect-tag">{k.matte && matteUnavailable ? 'Cutout unavailable' : k.asset ? 'Add media' : k.matte ? 'Auto cutout · Mac' : ['checklist', 'checklist-pop', 'headline-storm', 'growth-curve', 'count-up'].includes(k.id) ? 'Add your content' : 'Ready to use'}</span></button>)}</div>
              {!ordered.length && <div class="empty"><p>No effects match “{search}”.</p><button class="btn small" onClick={() => { setSearch(''); setFilter('All'); }}>Show all effects</button></div>}
            </>}
          </>}
          {panel === 'captions' && <><div class="vs-section-intro"><span class="label">The finishing details</span><h2>Every word, right.</h2><p class="muted small">{nat?.caption === 'C3' ? 'Spoken captions are off for this look. You can still send spelling and name-card changes to your agent here.' : 'Send spelling and name-card changes to your agent here.'}</p>{nat?.caption === 'C3' && <button class="btn ghost small" onClick={() => selectPanel('style')}>Choose a caption treatment<StudioIcon name="arrow"/></button>}</div>{captions}</>}
          {panel === 'export' && <>
            <div class="vs-section-intro"><span class="label">Ready when you are</span><h2>Make it shareable.</h2><p class="muted small">Export your complete video, with the current style and effects.</p></div>
            <div class="vs-export-summary"><span>Video</span><b>{version} · {tc(duration)}</b><span>Format</span><b>{data.timeline.width} × {data.timeline.height} · MP4</b><span>Style</span><b>{style?.name ?? 'Original'}</b><span>Effects</span><b>{settings.effects.filter(e => e.enabled).length} active</b></div>
            {nat && <p class="fine">{catalog.brandNat?.options.caption.find(o => o.code === nat.caption)?.name} · {catalog.brandNat?.options.layout.find(o => o.code === nat.layout)?.name} · {catalog.brandNat?.options.finish.find(o => o.code === nat.finish)?.name}</p>}
            {natIssue && <p class="vs-input-hint">{natIssue} <button class="btn small" onClick={() => selectPanel('style')}>Adjust this look</button></p>}
            {issues.length > 0 && <p class="vs-input-hint">Finish {issues.length} effect{issues.length > 1 ? 's' : ''} before exporting. <button class="btn small" onClick={() => chooseEffect(settings.effects.find(e => e.id === issues[0].id)!)}>Fix effect</button></p>}
            <button class="btn primary vs-wide-btn" disabled={busy || rendering || uploading || !!captionMessage} aria-describedby={captionMessage ? 'vs-caption-pending' : undefined} onClick={() => render(false)}>{rendering ? 'Rendering…' : 'Export full video'}<StudioIcon name="export"/></button>
            <div class="vs-render-check"><h3>Check a short section first</h3><label class="field">Start at · seconds<input aria-label="Preview start in seconds" type="number" min="0" step="0.1" max={Math.max(0, duration - .1)} value={Number(time.toFixed(2))} onChange={e => jump(Number(e.currentTarget.value))}/></label><button class="btn" disabled={busy || rendering || uploading} onClick={() => render(true)}>Render 6 seconds</button></div>
            {rendering && <div class="vs-render-progress" role="status"><div class="vs-progress-line"/><b>Rendering {job.preview ? 'your preview' : 'your export'}…</b><p class="fine">You can continue editing while this finishes.</p><details><summary>Render details</summary><pre class="log">{job.lines?.slice(-8).join('\n') || 'Preparing…'}</pre></details></div>}
            {exported && <div class="vs-export-ready"><span class="label">{staleExport ? 'Previous export' : 'Your video is ready'}</span><h3>{project.name}</h3><p class="fine">{staleExport ? 'Your latest edits are not in this file. Export again to include them.' : `${version} · ${tc(duration)} · MP4`}</p><a class="btn primary vs-wide-btn" href={media(project.id, exported.file)} download={`${project.name}-${version}-styled.mp4`}>Download {staleExport ? 'previous export' : 'video'}<StudioIcon name="download"/></a></div>}
            {result?.file && <button class="btn" onClick={watchRendered}>Watch {result.preview ? 'rendered preview' : 'last export'}</button>}
          </>}
        </div>
        <footer class="vs-inspector-footer"><div class="vs-mobile-history"><button class="vs-icon-btn" aria-label="Undo edit" disabled={!history.past.length || !data} onClick={() => travel('undo')}><StudioIcon name="undo"/></button><button class="vs-icon-btn" aria-label="Redo edit" disabled={!history.future.length || !data} onClick={() => travel('redo')}><StudioIcon name="redo"/></button></div><span class="fine">{dirty ? 'Style edits kept in this browser until saved.' : 'Style and effects saved to this project.'}</span><button class="btn ghost small" disabled={!dirty || busy} onClick={discard}>Reset</button></footer>
      </aside>
    </div>}
  </div>;
}
