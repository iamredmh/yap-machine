import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { previewCanPaint, PreviewPaintGate } from './readiness';
import { createRoot } from 'react-dom/client';
import { Player, Thumbnail, type PlayerRef } from '@remotion/player';
import type { VisualPlan } from '../src/yap/Visuals';
import type { StylePack } from '../src/engine/pack';
import volt from '../src/packs/volt.json';
import ledger from '../src/packs/ledger.json';
import sketch from '../src/packs/sketch.json';
import terminal from '../src/packs/terminal.json';
import glass from '../src/packs/glass.json';
import pop from '../src/packs/pop.json';
import natEditorial from '../src/packs/nat-editorial.json';
import natWarm from '../src/packs/nat-warm.json';
import natClean from '../src/packs/nat-clean.json';
import natScrapbook from '../src/packs/nat-scrapbook.json';
import natBold from '../src/packs/nat-bold.json';
const packs = { volt, ledger, sketch, terminal, glass, pop, 'nat-editorial':natEditorial, 'nat-warm':natWarm, 'nat-clean':natClean, 'nat-scrapbook':natScrapbook, 'nat-bold':natBold };
const query = new URLSearchParams(location.search);
const still = query.get('still') === '1';
const pack = query.get('pack') ?? 'volt';
const selected = packs[pack as keyof typeof packs];
if (!selected)
    throw new Error('Unknown preview style');
const globals = window as unknown as {
    __STYLE_PACK__: {
        pack: StylePack;
        hero?: string;
    };
    remotion_staticBase: string;
};
globals.__STYLE_PACK__ = { pack: selected as unknown as StylePack, hero: query.get('accent') || undefined };
globals.remotion_staticBase = '/live-preview';
// Each frame owns its pack globals, just as each export owns its input props.
const { Visuals } = await import('../src/yap/Visuals');
const { fontsReady } = await import('../src/engine/fonts');
await fontsReady;
await document.fonts.ready;
function Preview() {
    const [request, setRequest] = useState<{ plan: VisualPlan; revision: number; frame: number; seek: boolean } | null>(null);
    const playback = useRef({ playing: false, muted: true });
    const initial = useRef(0), ref = useRef<PlayerRef>(null), latestRevision = useRef(0);
    const root = useRef<HTMLDivElement>(null), buffering = useRef(false);
    const applyingPlayback = useRef(false), playbackAck = useRef(0);
    const send = (value: Record<string, unknown>) => parent.postMessage({ ...value, revision: latestRevision.current }, location.origin);
    const applyPlayback = () => {
        const player = ref.current;
        if (!player) return;
        applyingPlayback.current = true;
        cancelAnimationFrame(playbackAck.current);
        if (playback.current.muted !== player.isMuted()) { if (playback.current.muted) player.mute(); else player.unmute(); }
        if (playback.current.playing !== player.isPlaying()) { if (playback.current.playing) player.play(); else player.pause(); }
        // Remotion's mute and play setters settle independently. Echoing the
        // intermediate state would overwrite the host's unmute/play intent.
        playbackAck.current = requestAnimationFrame(() => {
            applyingPlayback.current = false;
            send({ type: 'yap-preview-playback', playing: player.isPlaying(), muted: player.isMuted() });
        });
    };
    useEffect(() => {
        const receive = (e: MessageEvent) => {
            if (e.origin !== location.origin || e.source !== parent) return;
            if (e.data?.type === 'yap-preview-state') {
                playback.current = { playing: !!e.data.playing, muted: e.data.muted !== false };
                applyPlayback(); return;
            }
            if (e.data?.type !== 'yap-preview-props') return;
            if (!e.data.plan || e.data.plan.pack !== pack) return;
            const revision = e.data.revision ?? 0;
            if (revision < latestRevision.current) return;
            latestRevision.current = revision;
            initial.current = e.data.frame ?? 0;
            setRequest({ plan: e.data.plan, revision, frame: initial.current, seek: !!e.data.seek });
        };
        const key = (e: KeyboardEvent) => {
            if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
            if (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 's') {
                e.preventDefault(); send({ type: 'yap-preview-command', command: e.key.toLowerCase() === 's' ? 'save' : e.shiftKey ? 'redo' : 'undo' });
            }
        };
        addEventListener('keydown', key); addEventListener('message', receive);
        send({ type: 'yap-preview-ready' });
        return () => { removeEventListener('message', receive); removeEventListener('keydown', key); };
    }, []);
    useLayoutEffect(() => {
        if (request?.seek) ref.current?.seekTo(request.frame);
    }, [request]);
    useEffect(() => {
        if (!request || still) return;
        const gate = new PreviewPaintGate(), revision = request.revision;
        let raf = 0, cancelled = false;
        const check = () => {
            if (cancelled || revision !== latestRevision.current || !ref.current || !root.current) return;
            const ready = previewCanPaint({
                fontsLoaded: document.fonts.status === 'loaded', buffering: buffering.current,
                pendingMasks: root.current.querySelectorAll('[data-mask-ready="false"]').length,
                videos: [...root.current.querySelectorAll('video')],
            });
            if (gate.observe(revision, ready)) send({ type: 'yap-preview-visible', pack });
            else raf = requestAnimationFrame(check);
        };
        raf = requestAnimationFrame(check);
        return () => { cancelled = true; cancelAnimationFrame(raf); };
    }, [request]);
    useLayoutEffect(() => {
        const player = ref.current;
        if (!player) return;
        let last = -1;
        const update = () => {
            const frame = player.getCurrentFrame();
            if (player.isPlaying() && Math.abs(frame - last) < 3) return;
            last = frame; send({ type: 'yap-preview-frame', frame });
        };
        const state = () => { if (!applyingPlayback.current) send({ type: 'yap-preview-playback', playing: player.isPlaying(), muted: player.isMuted() }); update(); };
        const waiting = () => { buffering.current = true; };
        const resume = () => { buffering.current = false; };
        player.addEventListener('waiting', waiting); player.addEventListener('resume', resume);
        player.addEventListener('frameupdate', update);
        player.addEventListener('play', state); player.addEventListener('pause', state); player.addEventListener('mutechange', state);
        applyPlayback(); state();
        return () => { cancelAnimationFrame(playbackAck.current); player.removeEventListener('waiting', waiting); player.removeEventListener('resume', resume); player.removeEventListener('frameupdate', update); player.removeEventListener('play', state); player.removeEventListener('pause', state); player.removeEventListener('mutechange', state); };
    }, [!!request]);
    if (!request) return <span>Preparing your video…</span>;
    const { plan } = request;
    if (still) return <Thumbnail component={Visuals} inputProps={plan} compositionWidth={plan.width} compositionHeight={plan.height} fps={plan.fps} durationInFrames={Math.max(1, Math.round(plan.duration * plan.fps))} frameToDisplay={initial.current} style={{ width: '100%', height: '100%' }}/>;
    return <div ref={root} style={{ width: '100%', height: '100%' }}><Player ref={ref} component={Visuals} inputProps={plan} compositionWidth={plan.width} compositionHeight={plan.height} fps={plan.fps} durationInFrames={Math.max(1, Math.round(plan.duration * plan.fps))} initialFrame={initial.current} controls={false} moveToBeginningWhenEnded={false} clickToPlay spaceKeyToPlayOrPause initiallyMuted style={{ width: '100%', height: '100%' }} errorFallback={({ error }) => <PreviewError message={error.message} revision={request.revision}/>}/></div>;
}
function PreviewError({ message, revision }: { message: string; revision: number }) {
    useEffect(() => { parent.postMessage({ type: 'yap-preview-error', message: `Preview could not load: ${message}`, revision }, location.origin); }, [message, revision]);
    return <div role="alert" style={{ padding: 20 }}>Preview could not load: {message}</div>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
