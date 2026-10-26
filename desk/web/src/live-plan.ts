/** Effects visible at this moment, using the compositor's inclusive start and exclusive end. */
export function activeEffectsAtTime<T extends { at: number; duration: number; enabled?: boolean }>(effects: readonly T[], time: number): T[] {
    if (!Number.isFinite(time)) return [];
    return effects.filter(effect => effect.enabled !== false
        && Number.isFinite(effect.at) && Number.isFinite(effect.duration) && effect.duration > 0
        && time >= effect.at && time < effect.at + effect.duration);
}

/** Build display props from the current edits, independently of saving/exporting. */
export function livePlan(source: any, settings: any, project: string, origin: string) {
    const url = (path: string) => new URL(path, origin).href;
    const effects = (settings.effects ?? []).filter((e: any) => {
        if (e.enabled === false || !Number.isFinite(e.at) || !Number.isFinite(e.duration) || e.duration <= 0)
            return false;
        if (['checklist', 'checklist-pop', 'headline-storm'].includes(e.type) && !e.items?.some((s: string) => s.trim()))
            return false;
        if (e.type === 'growth-curve' && (!Array.isArray(e.values) || e.values.length < 2 || !e.values.every(Number.isFinite)))
            return false;
        if (e.type === 'count-up' && (!Array.isArray(e.values) || e.values.length !== 2 || !e.values.every((v: number) => Number.isFinite(v) && Math.abs(v) <= 1e12)))
            return false;
        if (e.type === 'text-behind-person' && (!e.text?.trim()
            || (e.textSize !== undefined && (!Number.isFinite(e.textSize) || e.textSize < .06 || e.textSize > .3))
            || (e.textY !== undefined && (!Number.isFinite(e.textY) || e.textY < .1 || e.textY > .85))))
            return false;
        if (['b-roll-overlay', 'green-screen'].includes(e.type) && !e.asset)
            return false;
        if (e.type === 'zoom-through-cut' && !(source.cutBoundaries ?? []).some((t: number) => t >= e.at && t < e.at + e.duration))
            return false;
        if (['frame-escape', 'studio-reveal', 'paper-cutout', 'dolly-zoom', 'magazine-cover', 'green-screen', 'text-behind-person'].includes(e.type) && !source.mask)
            return false;
        return true;
    }).map((e: any) => ({ ...e,
        items: (e.items ?? []).map((s: string) => s.trim()).filter(Boolean),
        ...(e.type === 'zoom-through-cut' ? { joinAt: (source.cutBoundaries as number[]).filter(t => t >= e.at && t < e.at + e.duration).sort((a, b) => Math.abs(a - e.at - e.duration / 2) - Math.abs(b - e.at - e.duration / 2))[0] } : {}),
        ...(e.asset ? { asset: url(`/api/projects/${encodeURIComponent(project)}/visual-assets/${encodeURIComponent(e.asset.split('/').at(-1))}`), assetDuration: source.assetDurations?.[e.asset] } : {}),
    }));
    const original = settings.preset === 'original';
    return { ...source, original, pack: original ? 'volt' : settings.preset,
        accent: settings.accent ?? (original ? source.accent : undefined), motion: settings.motion, effects,
        captionStyle: original ? source.captionStyle : null, plate: url(source.plate),
        mask: source.mask ? { ...source.mask, url: url(source.mask.url) } : null };
}
