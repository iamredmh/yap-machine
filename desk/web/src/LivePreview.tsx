import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { livePlan } from './live-plan.js';
import { PreviewHandoff, type PreviewRequest } from './preview-handoff.js';
import type { BrandNat } from '../../src/core/brand-nat.js';

type PreviewValue = { plan: any; frame: number; seekId: number };
type Playback = { playing: boolean; muted: boolean };

function PreviewDocument({ request, visible, active, playback, onMessage }: {
  request: PreviewRequest<PreviewValue>; visible: boolean; active: boolean; playback: Playback;
  onMessage: (id: number, data: any) => void;
}) {
  const iframe = useRef<HTMLIFrameElement>(null), booted = useRef(false);
  const latest = useRef(request); latest.current = request;
  const activity = useRef({ active, playback }); activity.current = { active, playback };
  const receiveMessage = useRef(onMessage); receiveMessage.current = onMessage;
  const sentSeek = useRef<number | null>(null);
  const post = (data: unknown) => iframe.current?.contentWindow?.postMessage(data, location.origin);
  const send = () => {
    const value = latest.current;
    post({ type: 'yap-preview-props', ...value.value, revision: value.revision,
      seek: sentSeek.current !== value.value.seekId, playing: false, muted: true });
    sentSeek.current = value.value.seekId;
  };
  const state = () => post({ type: 'yap-preview-state',
    playing: activity.current.active && activity.current.playback.playing,
    muted: !activity.current.active || activity.current.playback.muted });
  useLayoutEffect(() => {
    const receive = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.source !== iframe.current?.contentWindow) return;
      if (e.data?.type === 'yap-preview-ready') { booted.current = true; sentSeek.current = null; send(); state(); }
      receiveMessage.current(request.id, e.data);
    };
    addEventListener('message', receive);
    return () => removeEventListener('message', receive);
  }, []);
  useLayoutEffect(() => { if (booted.current) send(); }, [request]);
  useLayoutEffect(() => { if (booted.current) state(); }, [active, playback.playing, playback.muted]);
  return <iframe ref={iframe} title={visible ? 'Live video preview' : 'Preparing video preview'} aria-hidden={!visible} tabIndex={visible ? 0 : -1}
    src={`/live-preview/index.html?pack=${encodeURIComponent(request.value.plan.pack)}&accent=${encodeURIComponent(request.value.plan.accent ?? '')}`}
    allow="autoplay; fullscreen" class="vs-live-frame" style={{ position: 'absolute', inset: 0, opacity: visible ? 1 : 0, pointerEvents: active ? 'auto' : 'none' }}/>;
}

export function LivePreview({ source, settings, project, seek, onTime, onCommand, transport, onPlayback, onReady }: {
  source: any; settings: any; project: string; seek: { time: number; id: number }; onTime: (time: number) => void; transport: { action: string; id: number }; onPlayback: (state: Playback) => void; onReady: (ready: boolean) => void; onCommand: (command: 'undo' | 'redo' | 'save') => void;
}) {
  const frame = useRef(0), lastSeek = useRef<typeof seek | null>(null);
  if (lastSeek.current !== seek) {
    frame.current = Math.max(0, Math.min(Math.round(seek.time * source.fps), Math.round(source.duration * source.fps) - 1));
    lastSeek.current = seek;
  }
  const playback = useRef<Playback>({ playing: false, muted: true });
  const handoff = useRef(new PreviewHandoff<PreviewValue>());
  const [, refresh] = useState(0);
  const [error, setError] = useState('');
  const plan = useMemo(() => livePlan(source, settings, project, location.origin), [source, settings, project]);
  const key = `${project}:${plan.pack}:${plan.accent ?? ''}`;
  const request = useMemo(() => handoff.current.request(key, { plan, frame: frame.current, seekId: seek.id }), [key, plan, seek]);
  const latestCallbacks = useRef({ onTime, onCommand, onPlayback, onReady });
  latestCallbacks.current = { onTime, onCommand, onPlayback, onReady };
  useLayoutEffect(() => { setError(''); latestCallbacks.current.onReady(false); }, [request]);
  const receive = (id: number, data: any) => {
    const h = handoff.current;
    if (!h.isCurrent(id)) return;
    if (data?.type === 'yap-preview-visible' && h.reveal(id, data.revision)) {
      latestCallbacks.current.onReady(true); refresh(n => n + 1);
    }
    if (data?.type === 'yap-preview-error' && h.isCurrent(id, data.revision)) setError(data.message || 'Preview could not load. Try the look again.');
    // The outgoing document is frozen and muted. Its late pause/frame messages
    // must not replace the new seek or the playback intent we will resume.
    if (h.visible?.id !== id) return;
    if (['yap-preview-frame', 'yap-preview-playback'].includes(data?.type) && !h.isCurrent(id, data.revision)) return;
    if (data?.type === 'yap-preview-frame' && Number.isFinite(data.frame)) {
      frame.current = data.frame; latestCallbacks.current.onTime(data.frame / plan.fps);
    }
    if (data?.type === 'yap-preview-playback') {
      playback.current = { playing: !!data.playing, muted: !!data.muted };
      latestCallbacks.current.onPlayback(playback.current);
    }
    if (data?.type === 'yap-preview-command' && ['undo', 'redo', 'save'].includes(data.command)) latestCallbacks.current.onCommand(data.command);
  };
  const sentTransport = useRef(0);
  useEffect(() => {
    if (!transport.action || sentTransport.current === transport.id) return;
    sentTransport.current = transport.id;
    playback.current = transport.action === 'play' ? { ...playback.current, playing: !playback.current.playing }
      : transport.action === 'mute' ? { ...playback.current, muted: !playback.current.muted } : playback.current;
    latestCallbacks.current.onPlayback(playback.current); refresh(n => n + 1);
  }, [transport]);
  const visible = handoff.current.visible, pending = visible?.id !== request.id;
  return <div style={{ position: 'relative', width: '100%', height: '100%' }} aria-busy={pending}>
    {handoff.current.entries().map(entry => <PreviewDocument key={entry.id} request={entry} visible={entry.id === visible?.id}
      active={entry.id === visible?.id && entry.id === request.id} playback={playback.current} onMessage={receive}/>)}
    {(pending || error) && <span role={error ? 'alert' : 'status'} style={{ position: 'absolute', bottom: 12, left: 12, right: 12, padding: '8px 10px', borderRadius: 8, color: 'white', background: '#242624dd', fontSize: 12, textAlign: 'center' }}>{error || 'Updating preview…'}</span>}
  </div>;
}

/** Static samples use the same compositor and the cut's own footage/words. */
export function StylePreview({ source, preset, accent, project, brandNat }: { source: any; preset: string; accent: string; project: string; brandNat?: Partial<BrandNat> }) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const plan = useMemo(() => livePlan(source, { preset, accent, brandNat, motion: 'balanced', effects: [] }, project, location.origin), [source, preset, accent, brandNat, project]);
  const latest = useRef(plan); latest.current = plan;
  const ready = useRef(false);
  const key = `${preset}:${accent}`;
  const send = () => iframe.current?.contentWindow?.postMessage({ type: 'yap-preview-props', plan: latest.current, frame: Math.min(Math.round(latest.current.fps * 1.2), Math.round(latest.current.duration * latest.current.fps) - 1), seek: true, playing: false, muted: true }, location.origin);
  useLayoutEffect(() => {
    ready.current = false;
    const receive = (e: MessageEvent) => { if (e.origin === location.origin && e.source === iframe.current?.contentWindow && e.data?.type === 'yap-preview-ready') { ready.current = true; send(); } };
    addEventListener('message', receive); return () => removeEventListener('message', receive);
  }, [key]);
  useEffect(() => { if (ready.current) send(); }, [plan]);
  return <iframe key={key} ref={iframe} title={`${preset} style sample`} aria-hidden="true" tabIndex={-1} loading="lazy" src={`/live-preview/index.html?pack=${encodeURIComponent(preset)}&accent=${encodeURIComponent(accent)}&still=1`} class="vs-style-frame"/>;
}
