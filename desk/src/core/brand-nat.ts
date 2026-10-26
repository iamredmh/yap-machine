/** Native Brand Nat treatments supported by both the Desk and the compositor. */
export const natPresets = ['nat-editorial', 'nat-warm', 'nat-clean', 'nat-scrapbook', 'nat-bold'] as const;
export const natCaptions = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9'] as const;
export const natHooks = ['none', 'H1', 'H3', 'H4', 'H5', 'H8', 'H10'] as const;
export const natLayouts = ['L4', 'L5', 'L6'] as const;
export const natFinishes = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'] as const;
export const natPositions = ['auto', 'top', 'bottom'] as const;
export type NatPreset = typeof natPresets[number];
export type BrandNat = {
    caption: typeof natCaptions[number]; hook: typeof natHooks[number]; layout: typeof natLayouts[number];
    finish: typeof natFinishes[number]; title: string; subtitle: string; emphasis?: string; position: typeof natPositions[number];
    subjectOverlap?: boolean;
};
const common = { title: '', subtitle: '', emphasis: '', position: 'auto' as const, subjectOverlap: false };
export const brandNatDefaults: Record<NatPreset, BrandNat> = {
    'nat-editorial': { ...common, hook: 'H10', caption: 'C9', layout: 'L4', finish: 'G2' },
    'nat-warm': { ...common, hook: 'H4', caption: 'C6', layout: 'L4', finish: 'G5' },
    'nat-clean': { ...common, hook: 'H5', caption: 'C5', layout: 'L4', finish: 'G4' },
    'nat-scrapbook': { ...common, hook: 'H8', caption: 'C1', layout: 'L5', finish: 'G3' },
    'nat-bold': { ...common, hook: 'H3', caption: 'C2', layout: 'L5', finish: 'G7' },
};
export function isNatPreset(preset: string): preset is NatPreset {
    return natPresets.includes(preset as NatPreset);
}
/** Missing fields inherit this look's defaults; supplied values are validated at the API boundary. */
export function resolveBrandNat(preset: string, value?: Partial<BrandNat>, catalogDefaults?: Partial<BrandNat>): BrandNat | undefined {
    return isNatPreset(preset) ? { ...brandNatDefaults[preset], ...catalogDefaults, ...value } : undefined;
}
export type LookCanvas = { width: number; height: number };
/** Wide canvases use a side panel; only the top title band can be overlapped. */
export function brandNatHasTopPanel(config?: Partial<BrandNat>, canvas?: LookCanvas): boolean {
    return (config?.layout === 'L5' || config?.layout === 'L6')
        && (!canvas || canvas.width / canvas.height < 1.25);
}
export function brandNatNeedsMask(preset: string, value?: Partial<BrandNat>, canvas?: LookCanvas): boolean {
    const config = resolveBrandNat(preset, value);
    return config?.hook === 'H1' || config?.finish === 'G6'
        || (config?.subjectOverlap === true && brandNatHasTopPanel(config, canvas));
}
