import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { livePlan } from './live-plan.js';
export function LivePreview({ source, settings, project, seek, onTime, onCommand, transport, onPlayback, onReady }: {
  source: any; settings: any; project: string; seek: { time: number; id: number }; onTime: (time: number) => void; transport: { action: string; id: number }; onPlayback: (state: { playing: boolean; muted: boolean }) => void; onReady: (ready: boolean) => void; onCommand: (command: 'undo' | 'redo' | 'save') => void;
}) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const frame = useRef(Math.max(0, Math.min(Math.round(seek.time * source.fps), Math.round(source.duration * source.fps) - 1)));
  const playback = useRef({ playing: false, muted: true });
  const command = useRef(onCommand); command.current = onCommand;
  const report = useRef(onTime); report.current = onTime;
  const reportReady = useRef(onReady); reportReady.current = onReady;
  const reportPlayback = useRef(onPlayback); reportPlayback.current = onPlayback;
  const [ready, setReady] = useState(false);
  const plan = useMemo(() => livePlan(source, settings, project, location.origin), [source, settings, project]);
  const key = `${plan.pack}:${plan.accent ?? ''}`;
  const latest = useRef(plan); latest.current = plan;
  const send = (seekTo = false) => iframe.current?.contentWindow?.postMessage({ type: 'yap-preview-props', plan: latest.current, frame: frame.current, seek: seekTo, ...playback.current }, location.origin);
  useLayoutEffect(() => {
    setReady(false); reportReady.current(false);
    const receive = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.source !== iframe.current?.contentWindow) return;
      if (e.data?.type === 'yap-preview-ready') { setReady(true); send(); }
      if (e.data?.type === 'yap-preview-visible') reportReady.current(true);
      if (e.data?.type === 'yap-preview-frame' && Number.isFinite(e.data.frame)) {
        frame.current = e.data.frame;
        report.current(e.data.frame / latest.current.fps);
      }
      if (e.data?.type === 'yap-preview-command' && ['undo', 'redo', 'save'].includes(e.data.command)) command.current(e.data.command);
      if (e.data?.type === 'yap-preview-playback') { playback.current = { playing: !!e.data.playing, muted: !!e.data.muted }; reportPlayback.current(playback.current); }
    };
    addEventListener('message', receive);
    return () => removeEventListener('message', receive);
  }, [key]);
  useEffect(() => { if (ready) send(); }, [plan, ready]);
  useEffect(() => {
    frame.current = Math.min(Math.max(Math.round(seek.time * source.fps), 0), Math.round(source.duration * source.fps) - 1);
    if (ready) send(true);
  }, [seek]);
  const sentTransport = useRef(0);
  useEffect(() => {
    if (ready && transport.action && sentTransport.current !== transport.id) {
      sentTransport.current = transport.id;
      iframe.current?.contentWindow?.postMessage({ type: 'yap-preview-transport', action: transport.action }, location.origin);
    }
  }, [transport, ready]);
  return <iframe key={key} ref={iframe} title="Live video preview" src={`/live-preview/index.html?pack=${encodeURIComponent(plan.pack)}&accent=${encodeURIComponent(plan.accent ?? '')}`} allow="autoplay; fullscreen" class="vs-live-frame"/>;
}

/** Static samples use the same compositor and the cut's own footage/words. */
export function StylePreview({ source, preset, accent, project }: { source: any; preset: string; accent: string; project: string }) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const plan = useMemo(() => livePlan(source, { preset, accent, motion: 'balanced', effects: [] }, project, location.origin), [source, preset, accent, project]);
  const latest = useRef(plan); latest.current = plan;
  const ready = useRef(false);
  const send = () => iframe.current?.contentWindow?.postMessage({ type: 'yap-preview-props', plan: latest.current, frame: Math.min(Math.round(latest.current.fps * 1.2), Math.round(latest.current.duration * latest.current.fps) - 1), seek: true, playing: false, muted: true }, location.origin);
  useEffect(() => {
    const receive = (e: MessageEvent) => { if (e.origin === location.origin && e.source === iframe.current?.contentWindow && e.data?.type === 'yap-preview-ready') { ready.current = true; send(); } };
    addEventListener('message', receive); return () => removeEventListener('message', receive);
  }, []);
  useEffect(() => { if (ready.current) send(); }, [plan]);
  return <iframe ref={iframe} title={`${preset} style sample`} aria-hidden="true" tabIndex={-1} loading="lazy" src={`/live-preview/index.html?pack=${encodeURIComponent(preset)}&accent=${encodeURIComponent(accent)}&still=1`} class="vs-style-frame"/>;
}
