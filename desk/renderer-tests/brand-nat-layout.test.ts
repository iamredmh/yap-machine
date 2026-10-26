import { describe, expect, it, vi } from 'vitest';
import { BrandNatCaptions, BrandNatPicture, resolveBrandNat } from '../../studio/src/yap/BrandNat';
import { captionBlockHeight, captionGroups, captionRegion, currentCaption, footageGeometry, hookVisibility, openingText, type BrandNatConfig } from '../../studio/src/yap/brand-nat-layout';
import { Visuals, type VisualPlan } from '../../studio/src/yap/Visuals';

const clock = vi.hoisted(() => ({ frame: 0 }));
vi.mock('../../studio/node_modules/remotion/dist/esm/index.mjs', () => ({
    AbsoluteFill: 'absolute-fill', Audio: 'audio', Freeze: 'freeze', Img: 'img', Loop: 'loop',
    OffthreadVideo: 'video', Sequence: 'sequence', useCurrentFrame: () => clock.frame,
    useVideoConfig: () => ({ width: 432, height: 768 }),
}));
vi.mock('../../studio/src/reel/Reel', () => ({ Reel: 'reel' }));
vi.mock('../../studio/src/reel/plan', () => ({ checkPlan: (plan: unknown) => plan }));
vi.mock('../../studio/src/engine/style', () => ({
    PACK: { id: 'nat-editorial', palette: { text: '#fff', panel: '#111', line: '#333', win: '#D8F4FA' }, grounds: { light: { colour: '#eee' } }, composition: { ground: 'light' }, subtitles: { case: 'none' } },
    HERO: '#D8F4FA', voiceFamily: (kind: string) => kind,
}));

const config: BrandNatConfig = { caption: 'C9', hook: 'H10', layout: 'L4', finish: 'G2', title: '', subtitle: '', position: 'auto' };
const source = { width: 432, height: 768, faceX: 216, crown: 75, eyes: 205, chin: 321 };
const words = ['Your', 'next', 'good', 'idea', 'deserves', 'a', 'great', 'edit.'].map((text, i) => ({ text, start: i * .5, end: i * .5 + .45 }));
const plan = (overrides: Partial<VisualPlan> = {}): VisualPlan => ({
    pack: 'nat-editorial', original: false, motion: 'balanced', width: 432, height: 768, fps: 24, duration: 5,
    plate: 'source.mp4', words, thirds: [], effects: [], brandNat: config,
    shoot: { ...source, tone: { chest: .1 } }, ...overrides,
});
const elements = (node: any): any[] => !node || typeof node !== 'object' ? [] : Array.isArray(node)
    ? node.flatMap(elements) : [node, ...elements(node.props?.children)];
const named = (node: any, name: string) => elements(node).filter(n => n.type?.name === name);
const text = (node: any): string => node == null || typeof node === 'boolean' ? '' : typeof node === 'string' || typeof node === 'number'
    ? String(node) : Array.isArray(node) ? node.map(text).join('') : text(node.props?.children);

describe('Brand Nat footage and safe caption geometry', () => {
    it.each([[432, 768], [768, 432], [540, 540]])('retains source aspect ratio in all layouts on a %s×%s canvas', (W, H) => {
        for (const layout of ['L4', 'L5', 'L6'] as const) {
            const g = footageGeometry(W, H, source, { ...config, layout });
            expect(g.image.width / g.image.height).toBeCloseTo(source.width / source.height, 8);
            expect(g.rect.x).toBeGreaterThanOrEqual(0);
            expect(g.rect.y).toBeGreaterThanOrEqual(0);
            expect(g.rect.x + g.rect.width).toBeLessThanOrEqual(W);
            expect(g.rect.y + g.rect.height).toBeLessThanOrEqual(H);
            expect(g.face.y).toBeGreaterThanOrEqual(g.rect.y);
            expect(g.face.bottom).toBeLessThanOrEqual(g.rect.y + g.rect.height);
        }
    });
    it('moves a requested top caption below the face when its whole staircase will not fit above', () => {
        const region = captionRegion({ W: 432, H: 768, face: { y: 75, bottom: 321 }, height: captionBlockHeight('C9', 432), position: 'top' });
        expect(region.y).toBeGreaterThan(321);
        expect(region.y + region.height).toBeLessThanOrEqual(768 * .84);
        expect(region.scale).toBe(1);
    });
    it('moves a requested bottom caption above a low face rather than placing text on it', () => {
        const region = captionRegion({ W: 432, H: 768, face: { y: 290, bottom: 640 }, height: captionBlockHeight('C5', 432), position: 'bottom' });
        expect(region.y + region.height).toBeLessThan(290);
        expect(region.scale).toBe(1);
    });
    it('keeps the whole B-roll caption block outside the speaker inset column', () => {
        const region = captionRegion({ W: 432, H: 768, face: { y: 75, bottom: 321 }, height: captionBlockHeight('C9', 432), position: 'auto', effects: ['b-roll-overlay'] });
        expect(region.x + region.width).toBeLessThan(432 * .67);
        expect(region.y).toBeGreaterThanOrEqual(768 * .735);
        expect(region.y + region.height).toBeLessThanOrEqual(768 * .84);
    });
    it('leaves readable room around an extreme close-up instead of cropping the face', () => {
        const close = { ...source, crown: 0, eyes: 250, chin: 740 };
        const g = footageGeometry(432, 768, close, config);
        expect(g.face.y).toBeGreaterThanOrEqual(0);
        expect(g.face.bottom).toBeLessThan(768 * .75);
        const region = captionRegion({ W: 432, H: 768, face: g.face, height: captionBlockHeight('C5', 432), position: 'bottom', hookReserved: true });
        expect(region.scale).toBe(1);
        expect(region.y).toBeGreaterThan(g.face.bottom);
    });
    it('fits the complete four-row staircase including the final italic word and underline', () => {
        const unit = 432, fontSize = unit * .078;
        const finalBottom = 3 * fontSize * 1.08 + fontSize * 1.8 + fontSize * .155;
        expect(captionBlockHeight('C9', unit)).toBeGreaterThan(finalBottom);
    });
    it('keeps an L6 caption entirely on one background and provides dark ink in the wide text panel', () => {
        clock.frame = 36;
        const l6 = { ...config, layout: 'L6' as const };
        const g = footageGeometry(432, 768, source, l6);
        const portrait = BrandNatCaptions({ p: plan(), config: l6 }) as any;
        const { top, height } = portrait.props.style;
        expect(top >= g.rect.y || top + height <= g.rect.y).toBe(true);
        const wide = BrandNatCaptions({ p: plan({ width: 768, height: 432 }), config: l6 }) as any;
        expect(wide.props.style.color).toBe('#29251F');
        expect(wide.props.style.left + wide.props.style.width).toBeLessThan(768 * .44);
    });
    it.each(['C6', 'C7'] as const)('gives %s head words explicit spacing independent of collapsed trailing whitespace', caption => {
        clock.frame = 36;
        const output = BrandNatCaptions({ p: plan(), config: { ...config, caption } });
        const gaps = elements(output).filter(n => n.type === 'span' && n.props.style?.marginRight === '.25em');
        expect(gaps.length).toBeGreaterThanOrEqual(2);
    });
    it('holds the complete staircase allocation fixed while later words reveal', () => {
        const p = plan();
        const samples = [0, 12, 24, 36].map(frame => { clock.frame = frame; return BrandNatCaptions({ p, config }) as any; });
        expect(samples.every(Boolean)).toBe(true);
        expect(samples.map(n => n.props.style)).toEqual(Array(4).fill(samples[0].props.style));
        expect(text(samples[0])).toBe(text(samples[3]));
        expect(elements(samples[0]).some(n => n.props?.style?.opacity === 0)).toBe(true);
        expect(elements(samples[3]).filter(n => n.props?.style?.opacity === 0)).toHaveLength(0);
    });
});

describe('Brand Nat timing and genuine text', () => {
    it('shows the full hook on frame zero and removes it by three seconds, including preview offsets', () => {
        expect(hookVisibility(0, 6)).toBe(1);
        expect(hookVisibility(2.7, 6)).toBe(1);
        expect(hookVisibility(2.9, 6)).toBeCloseTo(.5);
        expect(hookVisibility(3, 6)).toBe(0);
        expect(hookVisibility(0, 2, 3)).toBe(0);
        expect(hookVisibility(.9, 2, 2)).toBeCloseTo(.5);
        expect(hookVisibility(1, 2, 2)).toBe(0);
    });
    it('uses one video for H1 and removes its inverse mask after the hook ends, while G6 stays masked', () => {
        clock.frame = 0;
        const h1 = { ...config, hook: 'H1' as const };
        const afterHook = BrandNatPicture({ p: plan({ timelineOffset: 3 }), config: h1 });
        expect(named(afterHook, 'FittedVideo').filter(n => n.props.person)).toHaveLength(0);
        expect(named(afterHook, 'PersonMask')).toHaveLength(0);
        const intro = BrandNatPicture({ p: plan(), config: h1 });
        expect(named(intro, 'FittedVideo')).toHaveLength(1);
        expect(named(intro, 'PersonMask')[0].props.inverse).toBe(true);
        const finish = BrandNatPicture({ p: plan({ timelineOffset: 3 }), config: { ...h1, finish: 'G6' } });
        expect(named(finish, 'FittedVideo').filter(n => n.props.person)).toHaveLength(1);
    });
    it('keeps both H10 title lines and their spacing inside a square title band', () => {
        clock.frame = 0;
        const p = plan({ width: 540, height: 540 });
        const c = { ...config, layout: 'L5' as const, title: 'Your next idea', subtitle: 'Is worth sharing' };
        const hook = named(BrandNatPicture({ p, config: c }), 'Hook')[0];
        const output = hook.type(hook.props);
        const lines = elements(output).filter(n => n.type === 'p');
        const contentHeight = lines.reduce((h, n) => h + n.props.style.fontSize * n.props.style.lineHeight + (n.props.style.marginTop || 0), 0);
        expect(output.props.style.top + contentHeight).toBeLessThan(footageGeometry(540, 540, source, c).rect.y);
    });
    it('derives empty hook fields from actual words and preserves explicit editable text', () => {
        expect(openingText(words, '', '')).toEqual({ title: 'Your next good idea', subtitle: 'deserves a great edit.' });
        expect(openingText(words, '  A real title  ', '  A subtitle  ')).toEqual({ title: 'A real title', subtitle: 'A subtitle' });
        expect(openingText([], '', '')).toEqual({ title: '', subtitle: '' });
    });
    it('does not display a stale phrase over the next phrase or during long speech gaps', () => {
        const groups = captionGroups([{ text: 'First', start: 0, end: .6 }, { text: 'Second', start: .65, end: 1 }, { text: 'Third', start: 2, end: 2.5 }], 'C2');
        expect(currentCaption(groups, .649)?.[0].text).toBe('First');
        expect(currentCaption(groups, .65)?.[0].text).toBe('Second');
        expect(currentCaption(groups, 1.5)).toBeUndefined();
    });
    it.each(['C2', 'C9'] as const)('keeps every translated word in %s without inventing sequential translation timings', caption => {
        clock.frame = 12;
        const translated = 'Votre prochaine bonne idée mérite vraiment un beau montage.';
        const p = plan({ translation: [{ text: translated, start: .2, end: 1 }] });
        const output = BrandNatCaptions({ p, config: { ...config, caption } }) as any;
        expect(output.props['data-nat-caption']).toBe('C5');
        expect(text(output)).toBe(translated);
        expect(elements(output).filter(n => n.props?.style?.opacity === 0)).toHaveLength(0);
    });
    it('keeps gaps in the translation track silent instead of reverting to the source language', () => {
        clock.frame = 36;
        expect(BrandNatCaptions({ p: plan({ translation: [{ text: 'Bonjour', start: 0, end: 1 }] }), config })).toBeNull();
        expect(BrandNatCaptions({ p: plan({ translation: [] }), config })).toBeNull();
    });
    it('uses catalog defaults while allowing individual treatment overrides', () => {
        expect(resolveBrandNat({ pack: 'nat-warm' })).toMatchObject({ caption: 'C6', hook: 'H4', finish: 'G5' });
        const nat = resolveBrandNat({ pack: 'nat-editorial' });
        expect(nat).toMatchObject({ caption: 'C9', hook: 'H10', layout: 'L4', finish: 'G2' });
        expect(resolveBrandNat({ pack: 'volt' })).toBeNull();
        expect(resolveBrandNat({ pack: 'nat-editorial', brandNat: { ...config, title: 'My title', caption: 'C3' } })).toMatchObject({ title: 'My title', caption: 'C3' });
    });
});

describe('Brand Nat caption ownership', () => {
    it('C3 disables captions even when a translation exists', () => {
        clock.frame = 12;
        expect(captionGroups(words, 'C3')).toEqual([]);
        expect(BrandNatCaptions({ p: plan({ translation: [{ text: 'Bonjour', start: 0, end: 3 }] }), config: { ...config, caption: 'C3' } })).toBeNull();
    });
    it.each(['count-up', 'b-roll-overlay', 'growth-curve', 'zoom-portal', 'liquid-glass'])('keeps one Nat caption layer above %s and no legacy caption lane', type => {
        clock.frame = 24;
        const output = Visuals(plan({ effects: [{ id: 'test', type, at: 0, duration: 4, strength: 1 }] }));
        expect(named(output, 'BrandNatCaptions')).toHaveLength(1);
        expect(named(output, 'Caption')).toHaveLength(0);
        expect(named(named(output, 'EffectView'), 'BrandNatCaptions')).toHaveLength(0);
        expect(named(output, 'BrandNatCaptions')[0].props.activeTypes).toContain(type);
    });
    it.each(['b-roll-overlay', 'checklist', 'phone-mockup'])('uses a compact contrasting caption over an unknown %s background', type => {
        clock.frame = 36;
        const output = BrandNatCaptions({ p: plan(), config, activeTypes: [type] }) as any;
        expect(output.props['data-nat-caption']).toBe('C5');
        expect(elements(output).some(n => n.props?.style?.background === '#151A1DEB')).toBe(true);
        expect(BrandNatCaptions({ p: plan(), config: { ...config, caption: 'C3' }, activeTypes: [type] })).toBeNull();
    });
});


describe('Explicit caption emphasis', () => {
    it('ends a phrase on a chosen word while retaining exact original word timings', () => {
        const groups = captionGroups(words, 'C9', 'NEXT, idea');
        expect(groups.map(g => g.map(w => w.text))).toEqual([['Your', 'next'], ['good', 'idea'], ['deserves', 'a', 'great', 'edit.']]);
        expect(groups.flat()).toEqual(words);
    });
    it('matches punctuation and whitespace without changing phrase defaults when blank', () => {
        const sample = [{text:'An', start:0, end:.2}, {text:'IDEA,', start:.2, end:.5}, {text:'worth', start:.5, end:.8}];
        expect(captionGroups(sample, 'C5', ' idea, , ')).toHaveLength(2);
        expect(captionGroups(sample, 'C5', ' , ')).toEqual(captionGroups(sample, 'C5'));
        expect(captionGroups(words, 'C2', 'next')).toEqual(captionGroups(words, 'C2'));
        expect(captionGroups(words, 'C3', 'next')).toEqual([]);
    });
    it('keeps the ordinary size and gap limits even when a requested word is absent', () => {
        const groups = captionGroups(words, 'C9', 'absent');
        expect(groups).toEqual(captionGroups(words, 'C9'));
        expect(groups.every(g => g.length <= 4)).toBe(true);
    });
});
