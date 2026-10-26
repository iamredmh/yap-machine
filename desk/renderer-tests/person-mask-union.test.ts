import { describe, expect, it, vi } from 'vitest';
import { PersonMask } from '../../studio/src/yap/PersonLayer';

vi.mock('../../studio/node_modules/react/index.js', async importOriginal => {
    const actual = await importOriginal<Record<string, unknown>>();
    return { ...actual, useCallback: (fn: unknown) => fn, useId: () => 'mask-test', useLayoutEffect: () => {}, useRef: (current: unknown) => ({ current }), useState: (value: unknown) => [value, () => {}] };
});
vi.mock('../../studio/node_modules/remotion/dist/esm/index.mjs', () => ({
    OffthreadVideo: 'video', useCurrentFrame: () => 0, useVideoConfig: () => ({width: 540, height: 960}),
    useBufferState: () => ({delayPlayback: () => ({unblock: () => {}})}),
    useDelayRender: () => ({delayRender: () => 1, continueRender: () => {}}),
}));
const elements = (node: any): any[] => !node || typeof node !== 'object' ? [] : Array.isArray(node)
    ? node.flatMap(elements) : [node, ...elements(node.props?.children)];
const p = { plate: 'local.mp4', fps: 24, mask: {url: '/masks/', fps: 24, count: 48} };
const revealRect = {x: 0, y: 240, width: 540, height: 720};

describe('single-video speaker/footage union', () => {
    it('reveals only the footage rectangle after the person mask, relative to the actual canvas', () => {
        const output = PersonMask({p, children: null, revealRect, maskCanvas: {width: 540, height: 960}});
        const definition = elements(output).find(n => n.type?.name === 'MaskDefinition');
        const painted = elements(definition.type(definition.props)).filter(n => n.type === 'image' || n.type === 'rect');
        expect(painted.map(n => n.type)).toEqual(['image', 'rect']);
        expect(painted[1].props).toEqual({x: 0, y: .25, width: 1, height: .75, fill: 'white'});
        expect(painted[0].props.filter).toBeUndefined();
    });
    it('leaves inverse-mask polarity unchanged even when a reveal rectangle is supplied', () => {
        const output = PersonMask({p, children: null, inverse: true, revealRect});
        const definition = elements(output).find(n => n.type?.name === 'MaskDefinition');
        const painted = elements(definition.type(definition.props)).filter(n => n.type === 'image' || n.type === 'rect');
        expect(painted.map(n => n.type)).toEqual(['rect', 'image']);
        expect(painted[0].props).toEqual({x: 0, y: 0, width: 1, height: 1, fill: 'white'});
        expect(painted[1].props.filter).toContain('-inverse');
    });
    it('fails clearly without a cutout rather than exposing the source room over the title band', () => {
        expect(() => PersonMask({p: {...p, mask: null}, children: null, revealRect})).toThrow('needs an automatic person cutout');
    });
});
