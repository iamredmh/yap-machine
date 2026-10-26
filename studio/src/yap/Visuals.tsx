import React from 'react';
import { AbsoluteFill, Audio, Freeze, Img, Loop, OffthreadVideo, Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import { PACK, HERO, voiceFamily } from '../engine/style';
import { Reel } from '../reel/Reel';
import { checkPlan, type ReelPlan, type Shot } from '../reel/plan';
import type { Shoot } from '../kit/Presenter';
import { countUpSize, countUpText, effectEnvelope } from './effect-math';
type Word = {
    text: string;
    start: number;
    end: number;
};
export type Effect = {
    id: string;
    type: string;
    at: number;
    duration: number;
    strength: number;
    text?: string;
    textSize?: number;
    textY?: number;
    items?: string[];
    values?: number[];
    asset?: string;
    assetDuration?: number;
    joinAt?: number;
};
export type VisualPlan = {
    pack: string;
    original: boolean;
    accent?: string;
    motion: 'subtle' | 'balanced' | 'bold';
    width: number;
    height: number;
    fps: number;
    duration: number;
    plate: string;
    words: Word[];
    translation?: Word[] | null;
    captionStyle?: {font:string;size:number;color:string;active?:string;case:string;y:number;highlight:boolean;max_words:number;max_chars:number;outline:number;shadow:number}|null;
    effects: Effect[];
    thirds: any[];
    shoot: Omit<Shoot, 'plate'>;
    mask?: {
        url: string;
        fps: number;
        count: number;
    } | null;
    scenes?: Shot[];
};
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (x: number) => { x = clamp(x); return x * x * (3 - 2 * x); };
const fill: React.CSSProperties = { position: 'absolute', inset: 0 };
const groupWords = (words: Word[], max = 3, chars=24) => {
    const groups: Word[][] = [];
    for (const w of words) {
        const last = groups.at(-1);
        if (!last || last.length >= max || w.start - last.at(-1)!.end > .5 || /[.!?]$/.test(last.at(-1)!.text) || [...last, w].map(x => x.text).join(' ').length > chars)
            groups.push([w]);
        else
            last.push(w);
    }
    return groups;
};
const brief = (s: string, n = 3) => s.split(/\s+/).slice(0, n).join(' ');
/** Use the upstream templates, signature scenes and caption animation, with the
 * cut's actual words. Nothing is fabricated to fill a template. */
function reelPlan(p: VisualPlan): ReelPlan {
    const fps = p.fps, total = Math.max(1, Math.round(p.duration * fps));
    const captions = (p.translation ?? groupWords(p.words, PACK.id === 'ledger' ? 7 : 3).map(g => ({ text: g.map(w => w.text).join(' '), start: g[0].start, end: Math.min(p.duration, g.at(-1)!.end + .15) })))
        .map(c => ({ from: Math.max(0, Math.round(c.start * fps)), to: Math.min(total, Math.round(c.end * fps)), text: c.text })).filter(c => c.to > c.from);
    let shots: Shot[] = [];
    if (p.scenes?.length)
        shots = p.scenes;
    else {
        const step = (PACK.pace.short.secondsPerChange[0] + PACK.pace.short.secondsPerChange[1]) / 2 * (p.motion === 'subtle' ? 1.4 : p.motion === 'bold' ? .8 : 1);
        let at = 0, i = 0;
        while (at < total) {
            const frames = Math.min(total - at, Math.max(1, Math.round(step * fps)));
            const words = p.words.filter(w => w.start >= at / fps && w.start < (at + frames) / fps);
            const head = brief(words.map(w => w.text).join(' '), 3);
            let shot: Shot = { scene: 'talk', frames, props: { layout: PACK.id === 'ledger' || PACK.id === 'glass' ? 'halfBand' : PACK.id === 'terminal' ? 'tile' : 'full', head } };
            if (i === 0 && head && PACK.id !== 'pop') {
                const all = words.slice(0, 6).map(w => ({ t: w.text }));
                shot = { scene: 'title', frames, props: { lead: words.slice(0, 2).map(w => w.text).join(' '), lines: [all.slice(2, 4).length ? all.slice(2, 4) : all.slice(0, 2), all.slice(4).length ? all.slice(4).map(w => ({ ...w, hero: true })) : all.slice(0, 1).map(w => ({ ...w, hero: true }))], sizes: [150, 160] } };
            }
            else if (words.length && i === 1 && ['volt', 'pop', 'terminal'].includes(PACK.id) && !p.translation) {
                const gs = groupWords(words, 2).map(g => ({ from: Math.round(g[0].start * fps) - at, to: Math.min(frames, Math.round((g.at(-1)!.end + .1) * fps) - at), words: g.map((w, j) => ({ text: w.text, at: Math.max(0, Math.round(w.start * fps) - at), key: j === g.length - 1 })) }));
                shot = { scene: 'word-pop', frames, props: { groups: gs, size: 135 } };
            }
            else if (head && PACK.id === 'sketch' && i % 3 === 1)
                shot = { scene: 'doodle', frames, props: { note: head, from: 3 } };
            else if (head && PACK.id === 'glass' && i % 3 === 1)
                shot = { scene: 'float', frames, props: { title: head, facts: words.slice(3, 9).length ? [{ k: '', v: words.slice(3, 9).map(w => w.text).join(' ') }] : [{ k: '', v: head }] } };
            else if (head && PACK.id === 'pop' && i === 0)
                shot = { scene: 'sticker', frames, props: { stickers: [{ text: head, at: 3, kind: 'tag' }] } };
            const join = PACK.id === 'ledger' ? 'wipe' : PACK.id === 'terminal' ? 'glitch' : PACK.id === 'glass' ? 'blur' : PACK.id === 'pop' ? 'whip' : 'cut';
            if (i > 0 && i % 3 === 1 && p.motion !== 'subtle')
                shot.in = join;
            shots.push(shot);
            at += frames;
            i++;
        }
    }
    return checkPlan({ pack: p.pack, hero: p.accent, shoot: { ...p.shoot, plate: p.plate }, shots, captions }, PACK);
}
function Raw({ p, style = {} }: {
    p: VisualPlan;
    style?: React.CSSProperties;
}) {
    return <OffthreadVideo src={p.plate} muted style={{ ...fill, width: '100%', height: '100%', objectFit: 'cover', ...style }}/>;
}
function Person({ p, style = {} }: {
    p: VisualPlan;
    style?: React.CSSProperties;
}) {
    const f = useCurrentFrame();
    if (!p.mask)
        throw new Error('This effect needs a person mask. Re-render with person segmentation enabled.');
    const k = Math.max(1, Math.min(p.mask.count, Math.floor(f / p.fps * p.mask.fps) + 1));
    const url = p.mask.url + String(k).padStart(6, '0') + '.png';
    // Img waits for the mask before Remotion screenshots the frame.
    return <div style={{ ...fill, ...style }}><Img src={url} style={{ display: 'none' }}/><div style={{ ...fill, maskImage: `url("${url}")`, maskMode: 'luminance', maskSize: '100% 100%', WebkitMaskImage: `url("${url}")`, WebkitMaskSize: '100% 100%' }}><Raw p={p}/></div></div>;
}
function Backdrop({ accent, dark = false }: {
    accent: string;
    dark?: boolean;
}) {
    return <AbsoluteFill style={{ background: dark ? `radial-gradient(ellipse at 50% 0%,${accent}66,transparent 60%),#101016` : `radial-gradient(ellipse at 20% 10%,${accent}66,transparent 70%),${PACK.grounds[PACK.composition.ground].colour}`, backgroundImage: PACK.id === 'sketch' ? 'linear-gradient(#0001 1px,transparent 1px),linear-gradient(90deg,#0001 1px,transparent 1px)' : undefined, backgroundSize: '32px 32px' }}/>;
}
function Asset({ e, p }: {
    e: Effect;
    p: VisualPlan;
}) {
    if (!e.asset)
        return null;
    if (/\.(png|jpe?g|webp)(?:\?|$)/i.test(e.asset))
        return <Img src={e.asset} style={{ ...fill, width: '100%', height: '100%', objectFit: 'cover' }}/>;
    return <Sequence from={Math.round(e.at * p.fps)} layout="none"><Loop durationInFrames={Math.max(1, Math.round((e.assetDuration ?? e.duration) * p.fps))}><OffthreadVideo src={e.asset} muted style={{ ...fill, width: '100%', height: '100%', objectFit: 'cover' }}/></Loop></Sequence>;
}
function Caption({ p, y }: {
    p: VisualPlan;
    y?: number;
}) {
    const t = useCurrentFrame() / p.fps;
    const cs=p.captionStyle;
    const g = groupWords(p.words, cs?.max_words??(p.pack === 'ledger' ? 7 : 3),cs?.max_chars??24).find(g => t >= g[0].start && t < g.at(-1)!.end + .15);
    const tr = p.translation?.find(c => t >= c.start && t < c.end);
    if (!g && !tr)
        return null;
    const u = Math.min(p.width, p.height), accent = p.accent ?? HERO;
    const family=cs?.font.replace(/\s+(ExtraBold|SemiBold|Bold|Medium|Regular)$/,'');
    const weight=cs?(/ExtraBold/.test(cs.font)?800:/SemiBold/.test(cs.font)?600:/Bold/.test(cs.font)?700:/Medium/.test(cs.font)?500:400):800;
    const active=cs?(cs.highlight?cs.active:undefined):accent;
    return <div style={{ position: 'absolute', bottom: `${(1 - (y ?? cs?.y ?? .88)) * 100}%`, left: '8%', right: '8%', textAlign: 'center', fontFamily: family??(p.original ? 'Inter, sans-serif' : voiceFamily('body')), fontSize: u * (cs?.size??.065), fontWeight: weight, lineHeight: 1.12, color: cs?.color??'#fff', textShadow: `0 2px ${u*(cs?.shadow??.004)}px #000`, WebkitTextStroke: `${u * (cs?.outline??.002)}px #000`, textTransform: (cs?cs.case==='upper':PACK.subtitles.case==='uppercase') ? 'uppercase' : 'none' }}>
    {tr ? tr.text : g!.map((w, i) => <React.Fragment key={i}><span style={{ color: t >= w.start && t < w.end ? active : undefined }}>{w.text}</span>{' '}</React.Fragment>)}
  </div>;
}
function EffectView({ e, p, children }: {
    e: Effect;
    p: VisualPlan;
    children: React.ReactNode;
}) {
    const f = useCurrentFrame(), t = f / p.fps, local = t - e.at, progress = clamp(local / e.duration);
    const u = Math.min(p.width, p.height), W = p.width, H = p.height;
    const accent = p.accent ?? HERO, ink = PACK.palette.text, ground = PACK.grounds[PACK.composition.ground].colour;
    const motion = p.motion === 'subtle' ? .6 : p.motion === 'bold' ? 1.25 : 1;
    const { enter, exit: end } = effectEnvelope(local, e.duration);
    const card: React.CSSProperties = { background: PACK.id === 'glass' ? '#ffffff24' : PACK.id === 'ledger' || PACK.id === 'sketch' || PACK.id === 'pop' ? '#fff' : PACK.palette.panel, color: PACK.id === 'ledger' || PACK.id === 'sketch' || PACK.id === 'pop' ? '#111' : ink, border: PACK.id === 'pop' ? `${u * .006}px solid #111` : `${Math.max(1, u * .002)}px solid ${PACK.palette.line}`, borderRadius: PACK.id === 'terminal' ? 0 : u * .018, boxShadow: PACK.id === 'pop' ? `${u * .012}px ${u * .012}px 0 #111` : `0 ${u * .02}px ${u * .05}px #0004`, backdropFilter: PACK.id === 'glass' ? 'blur(20px)' : undefined };
    const textStyle: React.CSSProperties = { fontFamily: voiceFamily('display'), fontSize: u * .054, lineHeight: 1.1, overflowWrap: 'anywhere' };
    const labelled = (body: React.ReactNode) => <>{children}{body}</>;
    const zoom = (amount: number) => <AbsoluteFill style={{ transform: `scale(${1 + amount * e.strength * motion})`, transformOrigin: `50% ${p.shoot.eyes / p.shoot.height * 100}%` }}>{children}</AbsoluteFill>;
    const items = e.items ?? [];
    if (e.type === 'text-behind-person')
        return <><Raw p={p}/><div style={{ position: 'absolute', top: `${(e.textY ?? .3) * 100}%`, left: '5%', right: '5%', transform: `translateY(-50%) scale(${.96 + .04 * enter})`, opacity: enter, color: accent, fontFamily: voiceFamily('display'), fontSize: u * (e.textSize ?? .16), fontWeight: 900, letterSpacing: '-.04em', lineHeight: .94, textAlign: 'center', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap', textShadow: `0 ${u * .003}px ${u * .012}px #0003` }}>{e.text}</div><Person p={p}/></>;
    if (e.type === 'count-up') {
        const [start, target] = e.values ?? [0, 0];
        const number = countUpText(start, target, local, e.duration);
        return labelled(<div style={{ position: 'absolute', left: '9%', right: '9%', bottom: '26%', ...card, padding: `${u * .035}px ${u * .045}px`, textAlign: 'center', transform: `translateY(${(1 - enter) * u * .04}px)`, opacity: enter }}><div style={{ color: card.color, fontFamily: voiceFamily('display'), fontSize: countUpSize(start, target, u), fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1.05, whiteSpace: 'nowrap' }}>{number}</div>{e.text && <div style={{ ...textStyle, fontFamily: voiceFamily('body'), fontSize: u * .036, marginTop: u * .016 }}>{e.text}</div>}</div>);
    }
    if (e.type === 'snap-zoom')
        return zoom(.17 * smooth(local / .08) * smooth((e.duration - local) / .12));
    if (e.type === 'zoom-through-cut') {
        const d = t - (e.joinAt ?? e.at + e.duration / 2), a = Math.max(0, 1 - Math.abs(d) / Math.min(.28, e.duration / 2));
        return <AbsoluteFill style={{ filter: `blur(${a * 8 * motion}px)` }}>{zoom(a * .55)}</AbsoluteFill>;
    }
    if (e.type === 'digital-zoom')
        return <>{zoom(.28 * smooth(progress))}<div style={{ position: 'absolute', inset: '5%', border: `${u * .002}px solid #fffc`, borderRadius: u * .014, color: '#fff', font: `${u * .026}px monospace`, padding: u * .025, display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}><span>● REC</span><span>{(1 + progress * .28 * e.strength).toFixed(1)}×</span><span>{Math.floor(local / 60)}:{String(Math.floor(local % 60)).padStart(2, '0')}</span></div></>;
    if (e.type === 'orbit')
        return labelled(<>{['Aa', 'CC', '▶', '✂', '+', '♫'].map((label, i) => {
                const a = local * 1.2 * motion + i * Math.PI / 3;
                return <div key={i} style={{ position: 'absolute', left: `${50 + 36 * Math.cos(a)}%`, top: `${45 + 18 * Math.sin(a)}%`, transform: `translate(-50%,-50%) scale(${enter * (.8 + .2 * Math.sin(a))})`, zIndex: Math.sin(a) > 0 ? 3 : 1, ...card, width: u * .095, height: u * .095, display: 'grid', placeItems: 'center', font: `700 ${u * .032}px sans-serif`, color: i % 2 ? '#fff' : '#111', background: i % 2 ? accent : '#fff' }}>{label}</div>;
            })}</>);
    if (e.type === 'headline-storm')
        return labelled(<>{items.map((s, i) => {
                const since = local - i * .15, show = smooth(since / .15) * end;
                return <div key={i} style={{ position: 'absolute', top: `${9 + i * 8}%`, left: i % 2 ? '48%' : '4%', maxWidth: '48%', ...card, ...textStyle, fontSize: u * .037, padding: `${u * .014}px ${u * .025}px`, transform: `translateX(${(i % 2 ? 1 : -1) * (1 - show) * W}px) rotate(${i % 2 ? 5 : -5}deg)`, opacity: show, borderLeft: `${u * .014}px solid ${accent}` }}>{s}</div>;
            })}</>);
    if (e.type === 'checklist-pop' || e.type === 'checklist') {
        const full = e.type === 'checklist', complete = Math.min(items.length, Math.floor(progress * (items.length + 1)));
        const rows = <div style={{ ...card, ...textStyle, padding: u * .045, width: full ? '82%' : '47%', position: 'absolute', left: full ? '9%' : '4%', top: full ? '14%' : '6%', transform: `translateY(${(1 - enter) * u * .06}px)`, opacity: enter, fontSize: u * (full ? .052 : .036) }}>
      <div style={{ fontFamily: voiceFamily('code'), fontSize: u * .023, color: accent, marginBottom: u * .025 }}>{complete} / {items.length}</div>
      {e.text && <div style={{ marginBottom: u * .03, fontSize: u * .06 }}>{e.text}</div>}
      {items.map((s, i) => <div key={i} style={{ display: 'flex', gap: u * .02, marginTop: u * .023, opacity: complete > i ? 1 : .6 }}><span aria-hidden="true" style={{ color: accent, display: 'inline-flex', flex: '0 0 1.1em', width: '1.1em', height: '1.1em', alignItems: 'center', justifyContent: 'center' }}><svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/>{complete > i && <path d="m7 12 3 3 7-7"/>}</svg></span><span>{s}</span></div>)}
    </div>;
        return full ? <><Backdrop accent={accent}/>{rows}</> : labelled(rows);
    }
    if (e.type === 'phone-mockup' || e.type === 'chat-takeover') {
        const phone = e.type === 'phone-mockup';
        const border=u*(phone?.018:.002);
        const fit=Math.min((W*(phone?.64:.86)-2*border)/W,(H*(phone?.84:.76)*(phone?1:.75)-2*border)/H);
        return <><Backdrop accent={accent}/><div style={{ position: 'absolute', left: phone ? '18%' : '7%', right: phone ? '18%' : '7%', top: phone ? '8%' : '12%', bottom: phone ? '8%' : '12%', background: phone ? '#111' : ground, border: phone ? `${u * .018}px solid #151515` : `${u * .002}px solid ${PACK.palette.line}`, borderRadius: u * (phone ? .07 : .025), overflow: 'hidden', boxShadow: `0 ${u * .04}px ${u * .08}px #0006`, transform: `translateY(${(1 - enter) * H * .1}px) scale(${.92 + .08 * enter})` }}>
      <div style={{ height: phone ? '100%' : '75%', position: 'absolute', bottom: 0, left: 0, right: 0, overflow: 'hidden' }}><div style={{position:'absolute',width:W,height:H,left:'50%',top:'50%',transform:`translate(-50%,-50%) scale(${fit})`,transformOrigin:'center'}}>{children}</div></div>
      {phone ? <div style={{ position: 'absolute', top: u * .014, left: '35%', width: '30%', height: u * .035, borderRadius: u * .03, background: '#111' }}/> : <div style={{ padding: u * .04, color: ink, font: `${u * .035}px ${voiceFamily('body')}` }}><div style={{ color: accent, fontWeight: 700, marginBottom: u * .035 }}>Yap Machine</div><span style={{ ...card, padding: u * .02, display: 'inline-block' }}>{e.text || 'Make this moment stand out.'}</span></div>}
    </div></>;
    }
    if (e.type === 'b-roll-overlay')
        return <><Asset e={e} p={p}/><div style={{ position: 'absolute', right: '5%', bottom: '7%', width: '28%', height: '30%', borderRadius: u * .02, border: `${u * .004}px solid white`, overflow: 'hidden', boxShadow: '0 5px 30px #0007' }}><Raw p={p}/></div></>;
    if (e.type === 'growth-curve') {
        const vs = e.values ?? [], lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || 1;
        const points = vs.map((v, i) => `${100 + i / (vs.length - 1) * 800},${650 - (v - lo) / span * 400}`).join(' ');
        return <><Backdrop accent={accent} dark/><div style={{ position: 'absolute', top: '7%', left: '7%', right: '7%', ...textStyle, color: '#fff', fontSize: u * .07 }}>{e.text || 'Growth'}</div>
      <svg viewBox="0 0 1000 850" style={{ position: 'absolute', inset: '14% 3% 21%', width: '94%', height: '65%' }}><path d="M100 200 V680 H920" fill="none" stroke="#ffffff44" strokeWidth="2"/>
        <polyline points={points} pathLength={1} fill="none" stroke={accent} strokeWidth="9" strokeLinejoin="round" strokeDasharray="1" strokeDashoffset={1 - smooth(progress * 1.7)}/>
        {vs.map((v, i) => <g key={i} opacity={progress >= i / (vs.length + 1) ? 1 : 0}><circle cx={100 + i / (vs.length - 1) * 800} cy={650 - (v - lo) / span * 400} r="8" fill={accent}/><text x={100 + i / (vs.length - 1) * 800} y={620 - (v - lo) / span * 400} textAnchor="middle" fill="white" fontSize="30">{v}</text></g>)}
      </svg><div style={{ position: 'absolute', right: '7%', top: '14%', width: '24%', height: W * .24, borderRadius: '50%', overflow: 'hidden', border: `${u * .004}px solid white` }}><Raw p={p}/></div></>;
    }
    if (e.type === 'zoom-portal') {
        const size = u * (.25 + 1.4 * smooth(progress));
        return labelled(<div style={{ position: 'absolute', left: W * (.2 + .3 * progress) - size / 2, top: H * .4 - size / 2, width: size, height: size, borderRadius: '50%', overflow: 'hidden', border: `${u * .007}px solid ${accent}`, boxShadow: `0 0 ${u * .03}px ${accent}88`, opacity: end }}><div style={{ ...fill, width: W, height: H, left: -(W * .5 - size / 2), top: -(H * .4 - size / 2), transform: 'scale(1.1)' }}><Raw p={p}/></div></div>);
    }
    if (e.type === 'liquid-glass') {
        const x = W * (.25 + .35 * progress), y = H * (.3 + .16 * Math.sin(progress * Math.PI)), size = u * .44;
        const id = `lens-${e.id}`;
        return labelled(<><svg width="0" height="0"><filter id={id}><feTurbulence type="fractalNoise" baseFrequency=".012" numOctaves="2" seed="7" result="noise"/><feDisplacementMap in="SourceGraphic" in2="noise" scale={18 * e.strength} xChannelSelector="R" yChannelSelector="G"/></filter></svg>
      <div style={{ position: 'absolute', left: x - size / 2, top: y - size / 2, width: size, height: size, borderRadius: '48% 52% 54% 46%', overflow: 'hidden', border: `${u * .003}px solid #ffffffaa`, boxShadow: `inset 0 0 ${u * .04}px #fff9,0 ${u * .02}px ${u * .04}px #0003`, opacity: enter }}><div style={{ position: 'absolute', width: W, height: H, left: -x + size / 2, top: -y + size / 2, transform: 'scale(1.12)', transformOrigin: `${x}px ${y}px`, filter: `url(#${id}) saturate(1.15)` }}><Raw p={p}/></div></div></>);
    }
    if (e.type === 'frame-break') {
        const shatter = smooth(progress * 1.8), rows = 4, cols = 3;
        return <>{children}{Array.from({ length: rows * cols }, (_, i) => {
                const x = i % cols, y = Math.floor(i / cols), dx = (x - 1) * W * shatter * 1.6, dy = (y - 1.5) * H * shatter * .8;
                const clip = `polygon(${x / cols * 100}% ${y / rows * 100}%,${(x + 1) / cols * 100}% ${y / rows * 100}%,${(x + 1) / cols * 100}% ${(y + 1) / rows * 100}%,${x / cols * 100}% ${(y + 1) / rows * 100}%)`;
                return <AbsoluteFill key={i} style={{ clipPath: clip, transform: `translate(${dx}px,${dy}px) rotate(${(i % 2 ? 1 : -1) * shatter * 36}deg)`, opacity: 1 - shatter * .7, filter: 'drop-shadow(0 2px 2px #fff)' }}><Freeze frame={Math.max(0, Math.round(e.at * p.fps))}>{children}</Freeze></AbsoluteFill>;
            })}</>;
    }
    if (e.type === 'frame-escape')
        return <><Backdrop accent={accent} dark/><div style={{ ...fill, transform: `scale(.8) rotate(${-6 * enter}deg)`, border: `${u * .012}px solid #fff`, boxShadow: '0 10px 60px #0008', overflow: 'hidden' }}><Raw p={p}/></div><Person p={p} style={{ transform: `translateY(${-u * .08 * enter}px) scale(.86)` }}/></>;
    if (e.type === 'paper-cutout')
        return <><Backdrop accent={accent}/><div style={{ position: 'absolute', top: '10%', left: '8%', fontSize: u * .12, color: accent, transform: 'rotate(-12deg)' }}>✦</div><Person p={p} style={{ transform: `rotate(${-3 * enter}deg) scale(.94)`, filter: `drop-shadow(${u * .007}px 0 0 #fff) drop-shadow(${-u * .007}px 0 0 #fff) drop-shadow(0 ${u * .007}px 0 #fff) drop-shadow(0 ${u * .02}px ${u * .01}px #0005)` }}/>{e.text && <div style={{ position: 'absolute', bottom: '9%', left: '8%', ...card, ...textStyle, padding: u * .02, transform: 'rotate(-3deg)' }}>{e.text}</div>}</>;
    if (e.type === 'green-screen')
        return <><Asset e={e} p={p}/><Person p={p}/></>;
    if (e.type === 'dolly-zoom')
        return <><div style={{ ...fill, transform: `scale(${1 + .38 * smooth(progress) * e.strength})`, filter: 'blur(2px)' }}><Raw p={p}/></div><Person p={p} style={{ transform: `scale(${1 - .04 * smooth(progress) * e.strength})` }}/></>;
    if (e.type === 'studio-reveal')
        return <><Backdrop accent={accent} dark/><div style={{ position: 'absolute', inset: '8% 8% 0', background: 'linear-gradient(#ffffff08,#0005)', border: '1px solid #ffffff22', transform: `perspective(${W}px) rotateY(${(1 - enter) * 20}deg)` }}/>{[-1, 1].map(d => <div key={d} style={{ position: 'absolute', top: '12%', left: d < 0 ? '3%' : '79%', width: '18%', height: '24%', background: '#ffffee', boxShadow: `0 0 ${u * .1}px #fff8`, transform: `perspective(${W}px) rotateY(${d * 35}deg) translateY(${(1 - enter) * -H * .3}px)` }}/>)}<Person p={p}/><div style={{ position: 'absolute', top: '5%', left: '35%', right: '35%', textAlign: 'center', background: accent, color: '#111', padding: u * .01, font: `700 ${u * .028}px sans-serif` }}>{e.text || 'ON AIR'}</div></>;
    if (e.type === 'magazine-cover')
        return <><AbsoluteFill style={{ background: '#f8f3e6' }}/><div style={{ position: 'absolute', top: '7%', left: '5%', right: '5%', color: accent, fontFamily: voiceFamily('display'), fontSize: u * Math.min(.16, 1.3 / (e.text || 'THE EDIT').length), fontWeight: 900, letterSpacing: '-.05em' }}>{e.text || 'THE EDIT'}</div><div style={{ position: 'absolute', top: '28%', left: '5%', width: '30%', color: '#111', ...textStyle }}>{items[0] || ''}</div><div style={{ position: 'absolute', top: '38%', right: '5%', width: '27%', color: '#111', ...textStyle }}>{items[1] || ''}</div><Person p={p}/><div style={{ position: 'absolute', left: '6%', bottom: '7%', width: '16%', height: '5%', background: 'repeating-linear-gradient(90deg,#111 0 2px,#fff 2px 4px)' }}/></>;
    throw new Error(`Unknown effect: ${e.type}`);
}
export const Visuals: React.FC<VisualPlan> = (p) => {
    const f = useCurrentFrame(), { width: W, height: H } = useVideoConfig(), t = f / p.fps;
    const portrait = H / W > 1.6;
    const active = p.effects.filter(e => t >= e.at && t < e.at + e.duration);
    // Replacements discard the original caption tree; large overlays can cover
    // it. Render one readable lane above those pictures, in preview and export.
    const replacementCaptions = new Set(['b-roll-overlay', 'frame-escape', 'paper-cutout', 'green-screen', 'dolly-zoom', 'studio-reveal', 'magazine-cover', 'text-behind-person', 'growth-curve', 'checklist']);
    const overlayCaptions = new Set(['count-up', 'zoom-portal', 'liquid-glass', 'frame-break']);
    const fixedCaptions = active.some(e => replacementCaptions.has(e.type) || overlayCaptions.has(e.type)
        || (p.original && ['snap-zoom', 'digital-zoom', 'zoom-through-cut'].includes(e.type)));
    let captionY = p.captionStyle?.y ?? .88;
    // Reserve space for the bottom-right speaker inset and for central cards.
    // Honour a custom lane when it already clears the effect's content.
    if (active.some(e => e.type === 'count-up') && captionY > .47 && captionY < .84) captionY = .9;
    if (active.some(e => e.type === 'growth-curve' || e.type === 'checklist')) captionY = Math.max(captionY, .9);
    if (active.some(e => e.type === 'b-roll-overlay')) captionY = Math.min(captionY, .59);
    let picture: React.ReactNode;
    if (!p.original && portrait) {
        const plan = reelPlan(p);
        if (fixedCaptions) {
            plan.captions = [];
            // Word-pop is another spoken-caption track. Its centre words would
            // duplicate the rescued lane (and can be hidden under the card).
            plan.shots = plan.shots.map(shot => shot.scene === 'word-pop'
                ? { ...shot, scene: 'talk', props: { layout: 'full' } } : shot);
        }
        picture = <div style={{ position: 'absolute', left: 0, top: 0, width: 1080, height: 1920, transform: `scale(${W / 1080},${H / 1920})`, transformOrigin: '0 0' }}><Reel {...plan}/></div>;
    }
    else
        picture = <><Raw p={p}/>{!fixedCaptions && <Caption p={p}/>}</>;
    for (const e of active)
        picture = <EffectView key={e.id} e={e} p={p}>{picture}</EffectView>;
    // Phone/chat layouts carry their normal captions inside the video. Rescued
    // lanes stay above all effects, so later cards cannot hide the spoken words.
    return <AbsoluteFill style={{ background: '#101016', overflow: 'hidden' }}>{picture}{fixedCaptions && <Caption p={p} y={captionY}/>}
    {p.thirds.filter(n => t >= n.at && t < n.at + (n.duration ?? 4.5)).map((n, i) => <div key={i} style={{ position: 'absolute', left: '6%', bottom: '23%', background: '#fff', color: '#171717', borderLeft: `${Math.max(3, W * .006)}px solid ${p.accent ?? HERO}`, padding: `${W * .015}px ${W * .025}px`, borderRadius: W * .008, boxShadow: '0 4px 20px #0002', fontFamily: voiceFamily('body'), maxWidth: '75%' }}><strong style={{ display: 'block', fontSize: Math.min(W, H) * .04 }}>{n.name}</strong><span style={{ fontSize: Math.min(W, H) * .027 }}>{n.title}</span></div>)}
    <Audio src={p.plate}/>
  </AbsoluteFill>;
};
