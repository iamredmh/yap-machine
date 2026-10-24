import { useEffect, useRef, useState } from 'react';
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
const packs = { volt, ledger, sketch, terminal, glass, pop };
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
await import('../src/engine/fonts');
await document.fonts.ready;
function Preview() {
    const [plan, setPlan] = useState<VisualPlan | null>(null);
    const playback = useRef({ playing: false, muted: true });
    const initial = useRef(0), ref = useRef<PlayerRef>(null);
    const send = (value: unknown) => parent.postMessage(value, location.origin);
    useEffect(() => {
        const receive = (e: MessageEvent) => {
            if (e.origin !== location.origin || e.source !== parent) return;
            if (e.data?.type === 'yap-preview-transport') {
                const player = ref.current;
                if (e.data.action === 'play') { if (player?.isPlaying()) player.pause(); else player?.play(); }
                if (e.data.action === 'mute') { if (player?.isMuted()) player.unmute(); else player?.mute(); }
                return;
            }
            if (e.data?.type !== 'yap-preview-props') return;
            if (!e.data.plan || e.data.plan.pack !== pack)
                return;
            initial.current = e.data.frame ?? 0;
            playback.current = { playing: !!e.data.playing, muted: e.data.muted !== false };
            setPlan(e.data.plan);
            if (e.data.seek)
                ref.current?.seekTo(initial.current);
        };
        const key = (e: KeyboardEvent) => {
            if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
            if (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 's') {
                e.preventDefault(); send({ type: 'yap-preview-command', command: e.key.toLowerCase() === 's' ? 'save' : e.shiftKey ? 'redo' : 'undo' });
            }
        };
        addEventListener('keydown', key);
        addEventListener('message', receive);
        send({ type: 'yap-preview-ready' });
        return () => { removeEventListener('message', receive); removeEventListener('keydown', key); };
    }, []);
    useEffect(() => {
        if (!ref.current)
            return;
        let last = -1;
        const update = () => {
            const frame = ref.current?.getCurrentFrame() ?? 0;
            // Update the host at most 10 times per second during playback; seeks and pauses are exact.
            if (ref.current?.isPlaying() && Math.abs(frame - last) < 3) return;
            last = frame;
            send({ type: 'yap-preview-frame', frame });
        };
        const state = () => { send({ type: 'yap-preview-playback', playing: ref.current?.isPlaying(), muted: ref.current?.isMuted() }); update(); };
        const player = ref.current;
        player.addEventListener('frameupdate', update);
        player.addEventListener('play', state); player.addEventListener('pause', state); player.addEventListener('mutechange', state);
        state();
        send({ type: 'yap-preview-visible', pack });
        return () => { player.removeEventListener('frameupdate', update); player.removeEventListener('play', state); player.removeEventListener('pause', state); player.removeEventListener('mutechange', state); };
    }, [!!plan]);
    if (!plan)
        return <span>Preparing your video…</span>;
    if (still) return <Thumbnail component={Visuals} inputProps={plan} compositionWidth={plan.width} compositionHeight={plan.height} fps={plan.fps} durationInFrames={Math.max(1, Math.round(plan.duration * plan.fps))} frameToDisplay={initial.current} style={{ width: '100%', height: '100%' }}/>;
    return <Player ref={ref} component={Visuals} inputProps={plan} compositionWidth={plan.width} compositionHeight={plan.height} fps={plan.fps} durationInFrames={Math.max(1, Math.round(plan.duration * plan.fps))} initialFrame={initial.current} controls={false} clickToPlay spaceKeyToPlayOrPause autoPlay={playback.current.playing} initiallyMuted={playback.current.muted} style={{ width: '100%', height: '100%' }} errorFallback={({ error }) => <div role="alert" style={{ padding: 20 }}>Preview could not load: {error.message}</div>}/>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
