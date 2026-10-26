import { describe, expect, it } from 'vitest';
import { activeEffectsAtTime, livePlan } from './live-plan.js';
import { changeHistory, historyOf, travelHistory } from './studio-state.js';
import { brandNatDefaults, natPresets } from '../../src/core/brand-nat.js';
const source = { plate: '/media/demo/renders/__live-v1-a.mp4', width: 540, height: 960, fps: 30, duration: 8, words: [{ text: 'Hello', start: 0, end: 1 }], captionStyle: { font: 'Inter' }, accent: '#112233', cutBoundaries: [2, 4], mask: null };
const settings = { preset: 'volt', accent: '#FFE600', motion: 'balanced', effects: [] };
describe('effects at the playhead', () => {
    it('keeps the compositor boundaries and the supplied effect data', () => {
        const first = { id: 'checklist', at: 0, duration: 2.5, text: 'Ready to share' };
        const next = { id: 'zoom', at: 2.5, duration: 1, enabled: true, text: '' };
        const effects = [first, next] as const;
        expect(activeEffectsAtTime(effects, 0)[0]).toBe(first);
        expect(activeEffectsAtTime(effects, 2.499).map(e => e.id)).toEqual(['checklist']);
        expect(activeEffectsAtTime(effects, 2.5).map(e => e.id)).toEqual(['zoom']);
        expect(activeEffectsAtTime(effects, 3.5)).toEqual([]);
        expect(activeEffectsAtTime(effects, -0.01)).toEqual([]);
    });
    it('omits disabled or invalid timings instead of presenting a control for invisible content', () => {
        const valid = { id: 'visible', at: 0, duration: 2 };
        const effects = [valid, { ...valid, enabled: false }, { ...valid, at: NaN }, { ...valid, at: Infinity },
            { ...valid, duration: 0 }, { ...valid, duration: -1 }, { ...valid, duration: NaN }, { ...valid, duration: Infinity }];
        expect(activeEffectsAtTime(effects, 1)).toEqual([valid]);
        for (const time of [NaN, Infinity, -Infinity]) expect(activeEffectsAtTime(effects, time)).toEqual([]);
    });
});
describe('live styles preview', () => {
    it('uses each native Brand Nat pack and recipe in live previews and uncustomised thumbnail props', () => {
        for (const preset of natPresets) {
            const p = livePlan(source, { ...settings, preset }, 'demo', 'http://localhost');
            expect(p.pack).toBe(preset);
            expect(p.brandNat).toEqual(brandNatDefaults[preset]);
            expect(p.captionStyle).toBeNull();
            expect(p.words).toEqual(source.words);
            expect(p.plate).toBe('http://localhost' + source.plate);
        }
    });
    it('keeps custom title, caption and mask choices intact until real cutout media is ready', () => {
        const brandNat = { ...brandNatDefaults['nat-editorial'], title: 'Make this yours', subtitle: 'Start today', hook: 'H1', caption: 'C3', layout: 'L6', finish: 'G6', position: 'top' };
        const edited = { ...settings, preset: 'nat-editorial', brandNat };
        const waiting = livePlan(source, edited, 'demo', 'http://localhost');
        expect(waiting.brandNat).toEqual(brandNat);
        expect(waiting.mask).toBeNull();
        const ready = livePlan({ ...source, mask: { fps: 15, count: 120, url: '/masks/' } }, edited, 'demo', 'http://localhost');
        expect(ready.brandNat).toEqual(brandNat);
        expect(ready.mask.url).toBe('http://localhost/masks/');
        expect(livePlan({ ...source, brandNat }, settings, 'demo', 'http://localhost').brandNat).toBeUndefined();
    });
    it('waits for the presenter mask and retains editable headline placement for the shared compositor', () => {
        const behind = { id: 'behind', type: 'text-behind-person', at: 1, duration: 2, text: 'My story', textSize: .22, textY: .4 };
        expect(livePlan(source, { ...settings, effects: [behind] }, 'demo', 'http://localhost').effects).toEqual([]);
        const masked = { ...source, mask: { url: '/masks/', fps: 15, count: 120 } };
        const p = livePlan(masked, { ...settings, preset: 'original', effects: [behind] }, 'demo', 'http://localhost');
        expect(p.effects).toEqual([{ ...behind, items: [] }]);
        expect(p.plate).toBe('http://localhost' + source.plate);
        expect(p.captionStyle).toEqual(source.captionStyle);
        expect(activeEffectsAtTime(p.effects, 1)).toHaveLength(1);
        expect(activeEffectsAtTime(p.effects, 3)).toHaveLength(0);
        for (const invalid of [{ text: ' ' }, { textSize: .8 }, { textY: NaN }, { enabled: false }])
            expect(livePlan(masked, { ...settings, effects: [{ ...behind, ...invalid }] }, 'demo', 'http://localhost').effects).toEqual([]);
    });
    it('shows a count-up only after both real numbers are provided', () => {
        const count = { id: 'count', type: 'count-up', at: 0, duration: 2, text: 'Members' };
        for (const values of [[], [12], [0, 12, 24], [NaN, 12], [0, 1e13]])
            expect(livePlan(source, { ...settings, effects: [{ ...count, values }] }, 'demo', 'http://localhost').effects).toEqual([]);
        const p = livePlan(source, { ...settings, effects: [{ ...count, values: [0, 12.5] }] }, 'demo', 'http://localhost');
        expect(p.effects[0]).toMatchObject({ ...count, values: [0, 12.5] });
    });
    it('changes the composition props immediately while reusing the same undecorated cut', () => {
        const volt = livePlan(source, settings, 'demo', 'http://localhost:4690');
        const ledger = livePlan(source, { ...settings, preset: 'ledger', accent: '#D7261E' }, 'demo', 'http://localhost:4690');
        expect(volt.pack).toBe('volt');
        expect(ledger.pack).toBe('ledger');
        expect(ledger.accent).toBe('#D7261E');
        expect(ledger.plate).toBe(volt.plate);
        expect(ledger.words).toEqual(source.words);
        expect(ledger.captionStyle).toBeNull();
        expect(source.plate).toMatch(/^\/media/);
        expect(settings.preset).toBe('volt');
    });
    it('restores the original caption treatment when original is selected', () => {
        const p = livePlan(source, { ...settings, preset: 'original', accent: undefined }, 'demo', 'http://localhost');
        expect(p.original).toBe(true);
        expect(p.captionStyle).toEqual(source.captionStyle);
        expect(p.accent).toBe('#112233');
    });
    it('shows text and timing edits independently of save/export and omits incomplete draft effects', () => {
        const effects = [{ id: 'a', type: 'checklist-pop', at: 1, duration: 2, items: [' One ', ''], text: 'Now' },
            { id: 'b', type: 'growth-curve', at: 1, duration: 2, values: [] }, { id: 'c', type: 'paper-cutout', at: 0, duration: 1 },
            { id: 'd', type: 'orbit', at: 0, duration: 1, enabled: false }];
        const p = livePlan(source, { ...settings, effects }, 'demo', 'http://localhost');
        expect(p.effects).toHaveLength(1);
        expect(p.effects[0]).toMatchObject({ at: 1, text: 'Now', items: ['One'] });
        expect(effects[0].items).toEqual([' One ', '']);
    });
    it('uses the actual edit boundary and local supporting media/mask URLs', () => {
        const src = { ...source, mask: { url: '/api/projects/demo/visual-masks/key/', fps: 15, count: 120 }, assetDurations: { 'uploads/visual-123.mp4': .8 } };
        const effects = [{ id: 'a', type: 'b-roll-overlay', at: 0, duration: 2, asset: 'uploads/visual-123.mp4' },
            { id: 'b', type: 'zoom-through-cut', at: 1.5, duration: 1 }, { id: 'c', type: 'zoom-through-cut', at: 5, duration: 1 }];
        const p = livePlan(src, { ...settings, effects }, 'demo', 'http://localhost');
        expect(p.effects).toHaveLength(2);
        expect(p.effects[1].joinAt).toBe(2);
        expect(p.effects[0].asset).toBe('http://localhost/api/projects/demo/visual-assets/visual-123.mp4');
        expect(p.effects[0].assetDuration).toBe(.8);
        expect(p.mask.url).toMatch(/^http:\/\/localhost/);
    });
    it('turns off a checklist through edit history and restores its live picture with undo', () => {
        const checklist = { id: 'checklist', type: 'checklist-pop', at: 0, duration: 2.5, enabled: true,
            text: 'Ready to share', items: ['Choose your style', 'Share your story'] };
        const zoom = { ...checklist, id: 'zoom', type: 'snap-zoom', at: 2 };
        const original = { ...settings, effects: [checklist, zoom] };
        let history = historyOf(original);
        history = changeHistory(history, { ...history.present, effects: history.present.effects.map(e => e.id === checklist.id ? { ...e, enabled: false } : e) });
        const disabled = livePlan(source, history.present, 'demo', 'http://localhost');
        expect(disabled.effects.map((e: typeof checklist) => e.id)).toEqual(['zoom']);
        expect(activeEffectsAtTime(disabled.effects, 0.8)).toEqual([]);
        expect(original.effects[0].enabled).toBe(true);

        history = travelHistory(history, 'undo');
        const restored = livePlan(source, history.present, 'demo', 'http://localhost');
        expect(restored.effects[0]).toMatchObject(checklist);
        expect(activeEffectsAtTime<typeof checklist>(restored.effects, 0.8).map(e => e.id)).toEqual(['checklist']);
        expect(restored.effects.map((e: typeof checklist) => e.id)).toEqual(['checklist', 'zoom']);
    });
});
