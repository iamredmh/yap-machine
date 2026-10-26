import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { brandNatDefaults, brandNatNeedsMask, natCaptions, natFinishes, natHooks, natLayouts, natPositions, natPresets, resolveBrandNat } from './brand-nat.js';

describe('Brand Nat recipes', () => {
    it('keeps every Desk default and supported choice in step with the renderer catalog', () => {
        const catalog = JSON.parse(readFileSync(new URL('../../../studio/catalog.json', import.meta.url), 'utf8'));
        const recipes = [...catalog.styles, ...catalog.legacyStyles].filter((s: any) => s.brandNat);
        expect(recipes.map((s: any) => s.id).sort()).toEqual([...natPresets].sort());
        for (const preset of natPresets)
            expect(resolveBrandNat(preset)).toEqual(recipes.find((s: any) => s.id === preset).brandNat);
        for (const [field, codes] of Object.entries({ caption: natCaptions, hook: natHooks, layout: natLayouts, finish: natFinishes, position: natPositions }))
            expect(catalog.brandNat.options[field].map((o: any) => o.code)).toEqual(codes);
    });
    it('inherits the selected look without mutating defaults or an edited recipe', () => {
        const edited = { title: 'A real story', caption: 'C3' as const };
        expect(resolveBrandNat('nat-warm', edited)).toEqual({ ...brandNatDefaults['nat-warm'], ...edited });
        expect(resolveBrandNat('nat-clean')?.caption).toBe('C5');
        expect(brandNatDefaults['nat-warm'].title).toBe('');
        expect(edited).toEqual({ title: 'A real story', caption: 'C3' });
        expect(resolveBrandNat('original', edited)).toBeUndefined();
    });
    it('requests real person masks only for behind-speaker or cool-editorial choices', () => {
        for (const preset of natPresets) expect(brandNatNeedsMask(preset)).toBe(false);
        expect(brandNatNeedsMask('nat-clean', { hook: 'H1' })).toBe(true);
        expect(brandNatNeedsMask('nat-clean', { finish: 'G6' })).toBe(true);
        expect(brandNatNeedsMask('nat-clean', { hook: 'none', finish: 'G2' })).toBe(false);
        expect(brandNatNeedsMask('volt', { hook: 'H1' })).toBe(false);
    });
});
