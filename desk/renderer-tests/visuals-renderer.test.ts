import { describe, expect, it, vi } from 'vitest';
import { Visuals, type VisualPlan } from '../../studio/src/yap/Visuals';

const clock = vi.hoisted(() => ({ frame: 24 }));
vi.mock('../../studio/node_modules/remotion/dist/esm/index.mjs', () => ({
    AbsoluteFill: 'absolute-fill', Audio: 'audio', Freeze: 'freeze', Img: 'img', Loop: 'loop',
    OffthreadVideo: 'video', Sequence: 'sequence', spring: () => 1,
    useCurrentFrame: () => clock.frame, useVideoConfig: () => ({ width: 432, height: 768 }),
}));
vi.mock('../../studio/src/reel/Reel', () => ({ Reel: 'reel' }));
vi.mock('../../studio/src/engine/style', () => ({
    PACK: { id: 'volt', palette: { text: '#fff', panel: '#111', line: '#333' }, grounds: { base: { colour: '#111' } }, composition: { ground: 'base' }, subtitles: { case: 'sentence' } },
    HERO: '#EF6B30', voiceFamily: () => 'sans-serif',
}));
vi.mock('../../studio/src/reel/plan', () => ({ checkPlan: (plan: unknown) => plan }));

const props = (type: string): VisualPlan => ({
    pack: 'volt', original: true, motion: 'bold', width: 432, height: 768, fps: 24, duration: 4,
    plate: 'source.mp4', words: [{ text: 'Still readable', start: 0, end: 4 }], thirds: [],
    shoot: { width: 432, height: 768, faceX: 216, crown: 90, eyes: 180, chin: 310, tone: { chest: .1 } },
    effects: [{ id: 'zoom', type, at: 1, duration: 2, strength: 2 }],
});
const named = (node: any, name: string): any[] => !node ? [] : Array.isArray(node)
    ? node.flatMap(n => named(n, name))
    : [...(node.type?.name === name ? [node] : []), ...named(node.props?.children, name)];
const elements = (node: any): any[] => !node || typeof node !== 'object' ? [] : Array.isArray(node)
    ? node.flatMap(elements) : [node, ...elements(node.props?.children)];
const drawEffect = (p: VisualPlan, frame: number) => {
    clock.frame = frame;
    const element = named(Visuals(p), 'EffectView')[0];
    return element.type(element.props);
};

describe('original captions during camera effects', () => {
    it.each(['snap-zoom', 'digital-zoom', 'zoom-through-cut'])('keeps one caption lane outside %s, including combined cutout effects', type => {
        clock.frame = 24;
        const p = props(type);
        p.effects.unshift({ id: 'behind', type: 'text-behind-person', at: 0, duration: 4, strength: 1, text: 'Story' });
        const output = Visuals(p) as any;
        const effects = named(output, 'EffectView');
        expect(effects).toHaveLength(2);
        expect(named(effects, 'Caption')).toHaveLength(0);
        expect(named(output, 'Caption')).toHaveLength(1);
        expect(output.props.children.flat().some((node: any) => node?.type?.name === 'Caption')).toBe(true);
    });
    it('retains normal composition before and at the exclusive end of the zoom', () => {
        for (const frame of [23, 72]) {
            clock.frame = frame;
            const output = Visuals(props('snap-zoom')) as any;
            expect(named(output, 'EffectView')).toHaveLength(0);
            expect(named(output, 'Caption')).toHaveLength(1);
        }
    });
});

describe('stable animated card layout', () => {
    it('keeps counter typography and the settled card position fixed from zero through a large total', () => {
        const p = props('count-up');
        p.effects = [{ id: 'count', type: 'count-up', at: 0, duration: 4, strength: 1, values: [0, 1_000_000_000], text: 'Views' }];
        const samples = [0, 12, 48, 90].map(frame => elements(drawEffect(p, frame)));
        const numbers = samples.map(nodes => nodes.find(n => n.props?.style?.fontVariantNumeric === 'tabular-nums'));
        expect(numbers[0].props.children).toBe('0');
        expect(numbers.at(-1).props.children).toBe('1,000,000,000');
        expect(new Set(numbers.map(n => n.props.style.fontSize)).size).toBe(1);
        expect(numbers.every(n => n.props.style.whiteSpace === 'nowrap')).toBe(true);
        for (const nodes of samples.slice(1))
            expect(nodes.find(n => n.props?.style?.bottom === '26%').props.style.transform).toBe('translateY(0px)');
    });
    it('keeps checklist mark boxes identical as ticks appear, so labels cannot rewrap', () => {
        const p = props('checklist-pop');
        p.effects = [{ id: 'list', type: 'checklist-pop', at: 0, duration: 4, strength: 1, items: ['Find the idea', 'Shape the story', 'Make it yours'] }];
        const unchecked = elements(drawEffect(p, 0)), checked = elements(drawEffect(p, 48));
        const marks = (nodes: any[]) => nodes.filter(n => n.type === 'span' && n.props['aria-hidden']);
        expect(marks(unchecked)).toHaveLength(3);
        expect(marks(checked).map(n => n.props.style)).toEqual(marks(unchecked).map(n => n.props.style));
        expect(marks(checked).every(n => n.props.style.flex === '0 0 1.1em')).toBe(true);
        expect(unchecked.filter(n => n.type === 'path')).toHaveLength(0);
        expect(checked.filter(n => n.type === 'path')).toHaveLength(2);
    });
});


describe('caption continuity across full-frame effects', () => {
    const rescued = ['b-roll-overlay', 'growth-curve', 'checklist', 'count-up', 'zoom-portal', 'liquid-glass', 'frame-break'];
    it.each(rescued)('keeps exactly one caption above %s in Original and styled compositions', type => {
        for (const original of [true, false]) {
            clock.frame = 36;
            const p = { ...props(type), original, scenes: [{ scene: 'talk' as const, frames: 96, props: { layout: 'full' } }] };
            const output = Visuals(p) as any;
            expect(named(output, 'Caption')).toHaveLength(1);
            expect(named(named(output, 'EffectView'), 'Caption')).toHaveLength(0);
            expect(output.props.children[1].type.name).toBe('Caption');
            if (!original) expect(elements(output).find(n => n.type === 'reel')?.props.captions).toEqual([]);
        }
    });
    it('reserves a caption lane above the B-roll speaker and below counter/chart content', () => {
        clock.frame = 36;
        for (const [type, expected] of [['b-roll-overlay', .59], ['count-up', .9], ['growth-curve', .9], ['checklist', .9]] as const) {
            const p = props(type);
            p.captionStyle = { font: 'Inter Bold', size: .055, color: '#fff', case: 'sentence', y: .6, highlight: true, max_words: 3, max_chars: 24, outline: .002, shadow: .004 };
            const caption = named(Visuals(p), 'Caption')[0];
            expect(caption.props.y).toBe(expected);
            expect(parseFloat(caption.type(caption.props).props.style.bottom)).toBeCloseTo((1 - expected) * 100);
        }
        const custom = props('count-up');
        custom.captionStyle = { font: 'Inter Bold', size: .055, color: '#fff', case: 'sentence', y: .3, highlight: false, max_words: 3, max_chars: 24, outline: .002, shadow: .004 };
        expect(named(Visuals(custom), 'Caption')[0].props.y).toBe(.3);
    });
    it('restores the normal styled caption lane outside the effect window', () => {
        for (const frame of [23, 72]) {
            clock.frame = frame;
            const p = { ...props('count-up'), original: false, scenes: [{ scene: 'talk' as const, frames: 96, props: { layout: 'full' } }] };
            const output = Visuals(p) as any;
            expect(named(output, 'Caption')).toHaveLength(0);
            expect(elements(output).find(n => n.type === 'reel')?.props.captions).toHaveLength(1);
        }
    });
    it('replaces a word-pop caption scene with footage only while a rescued lane is active', () => {
        const p = { ...props('count-up'), original: false, scenes: [{ scene: 'word-pop' as const, frames: 96, props: { groups: [{ from: 0, to: 96, words: [{ text: 'Still readable', at: 0 }] }] } }] };
        clock.frame = 36;
        const rescued = elements(Visuals(p)).find(n => n.type === 'reel');
        expect(rescued.props.shots[0]).toEqual({ scene: 'talk', frames: 96, props: { layout: 'full' } });
        expect(rescued.props.captions).toEqual([]);
        clock.frame = 72;
        expect(elements(Visuals(p)).find(n => n.type === 'reel').props.shots[0].scene).toBe('word-pop');
    });
});
