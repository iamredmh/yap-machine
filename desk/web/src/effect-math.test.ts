import { describe, expect, it } from 'vitest';
import { countUpSize, countUpText, countUpValue, effectEnvelope } from '../../../studio/src/yap/effect-math';

describe('stable effect entrance and exit', () => {
    it.each([.1, 2, 6])('never rebounds and settles exactly, including a %s second effect', duration => {
        const rise = Math.min(.25, duration * .35), fall = Math.min(.18, duration * .25);
        const entrance = Array.from({ length: 101 }, (_, i) => effectEnvelope(i / 100 * rise, duration).enter);
        expect(entrance[0]).toBe(0);
        expect(entrance.at(-1)).toBe(1);
        expect(entrance.every((v, i) => v >= 0 && v <= 1 && (!i || v >= entrance[i - 1]))).toBe(true);
        for (let i = 0; i <= 100; i++)
            expect(effectEnvelope(rise + (duration - fall - rise) * i / 100, duration)).toEqual({ enter: 1, exit: 1 });
        const exit = Array.from({ length: 101 }, (_, i) => effectEnvelope(duration - fall + i / 100 * fall, duration).enter);
        expect(exit[0]).toBe(1);
        expect(exit.at(-1)).toBe(0);
        expect(exit.every((v, i) => v >= 0 && v <= 1 && (!i || v <= exit[i - 1]))).toBe(true);
        expect(effectEnvelope(-1, duration).enter).toBe(0);
        expect(effectEnvelope(duration + 1, duration).enter).toBe(0);
    });
});

describe('count-up timing shared by preview and export', () => {
    it('starts at the given number, reaches the exact target, and holds it during the exit', () => {
        expect(countUpValue(10, 100, -1, 5)).toBe(10);
        expect(countUpValue(10, 100, 0, 5)).toBe(10);
        expect(countUpValue(10, 100, 2, 5)).toBe(55);
        expect(countUpValue(10, 100, 4, 5)).toBe(100);
        expect(countUpValue(10, 100, 4.99, 5)).toBe(100);
    });
    it('supports decreasing, negative and fractional totals without inventing rounding at the endpoint', () => {
        expect(countUpText(12.5, -3.75, 0, 2)).toBe('12.50');
        expect(countUpText(12.5, -3.75, 1.8, 2)).toBe('-3.75');
        expect(countUpText(0, 1200, 2, 2)).toBe('1,200');
        expect(countUpText(7, 7, 1, 2)).toBe('7');
        expect(countUpText(0, .00000001, 2, 2)).toBe('0.00000001');
    });
    it('reserves the full formatted range before large numbers grow or shrink', () => {
        expect(countUpSize(0, 1_000_000_000, 432)).toBe(countUpSize(1_000_000_000, 0, 432));
        expect(countUpSize(0, 1_000_000_000, 432)).toBeLessThan(countUpSize(0, 12, 432));
        expect(countUpSize(-12.5, 3.75, 432)).toBeGreaterThan(0);
    });
});
