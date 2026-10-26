/** Reach the creator's exact target before the exit animation, including descending totals. */
export function countUpValue(start: number, end: number, local: number, duration: number): number {
    const progress = Math.max(0, Math.min(1, local / (duration * .8)));
    const eased = progress * progress * (3 - 2 * progress);
    return start + (end - start) * eased;
}

/** Keep fractional totals accurate without exposing interpolation noise. */
export function countUpText(start: number, end: number, local: number, duration: number): string {
    const precision = (value: number) => {
        const [digits, exponent = '0'] = String(value).toLowerCase().split('e');
        return Math.max(0, (digits.split('.')[1]?.length ?? 0) - Number(exponent));
    };
    const decimals = Math.max(precision(start), precision(end));
    const value = countUpValue(start, end, local, duration);
    if (decimals > 20) return value.toString();
    return value.toLocaleString('en-US', {
        minimumFractionDigits: decimals, maximumFractionDigits: decimals,
    });
}
const smooth = (value: number): number => {
    const p = Math.max(0, Math.min(1, value));
    return p * p * (3 - 2 * p);
};

/** A short, monotonic entrance and exit, with an exactly still interval between. */
export function effectEnvelope(local: number, duration: number): { enter: number; exit: number } {
    if (!Number.isFinite(local) || !Number.isFinite(duration) || duration <= 0)
        return { enter: 0, exit: 0 };
    const exit = smooth((duration - local) / Math.min(.18, duration * .25));
    return { enter: smooth(local / Math.min(.25, duration * .35)) * exit, exit };
}


/** Size the whole count once, so growing numbers cannot change the card's height. */
export function countUpSize(start: number, end: number, unit: number): number {
    const longest = Math.max(countUpText(start, end, 0, 1).length, countUpText(start, end, 1, 1).length, 1);
    return unit * Math.min(.15, 1.15 / longest);
}
