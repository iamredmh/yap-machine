import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installVisuals, visualCatalog, visualCut } from './visuals.js';
import { DeskError } from '../core/errors.js';
import { z } from 'zod';
import { runEngine } from '../core/engine.js';
vi.mock('../core/engine.js', () => ({ runEngine: vi.fn(async () => ({ code: 0, out: '' })) }));
let home: string, app: Hono;
const request = (path: string, body?: unknown) => app.request('http://localhost' + path, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const url = '/api/projects/p/versions/v1/visuals';
beforeEach(async () => {
    vi.clearAllMocks();
    home = await mkdtemp(join(tmpdir(), 'yap-visuals-api-'));
    await mkdir(join(home, 'p', 'cuts', 'v1'), { recursive: true });
    await writeFile(join(home, 'p', 'project.json'), JSON.stringify({ sources: [] }));
    await writeFile(join(home, 'p', 'cuts', 'v1', 'timeline.json'), JSON.stringify({ duration: 10, width: 1080, height: 1920, segments: [{ source: 'a', start: 20, end: 25, out_start: 0, out_end: 5, text: 'Hello' }, { source: 'a', start: 40, end: 45, out_start: 5, out_end: 10, text: 'Again' }] }));
    app = new Hono();
    app.onError((e, c) => c.json({ message: e.message }, e instanceof DeskError ? e.status as 400 : e instanceof z.ZodError ? 400 : 500));
    installVisuals(app, home, () => { });
});
afterEach(async () => { await rm(home, { recursive: true, force: true }); });
const good = { preset: 'volt', motion: 'balanced', effects: [{ id: 'one', type: 'snap-zoom', at: 1, duration: 2, strength: 1, enabled: true, text: '', items: [], values: [] }] };
async function save(settings: unknown = good, rev = 0, timelineRev?: string) {
    const d = await (await request(url)).json();
    return request(url, { rev, settings, timelineRev: timelineRev ?? d.timelineRev });
}
describe('styles and effects API', () => {
    it('prepares one undecorated source for all style choices and concurrent viewers', async () => {
        vi.mocked(runEngine).mockResolvedValueOnce({ code: 0, out: JSON.stringify({ plate: join(home, 'p', 'renders', '__live-v1-abc.mp4'), effects: [], words: [] }) + '\n' });
        const path = '/api/projects/p/versions/v1/visual-source';
        const [a, b] = await Promise.all([request(path), request(path)]);
        expect(a.status).toBe(200);
        expect(b.status).toBe(200);
        expect((await a.json()).plan.plate).toBe('/media/p/renders/__live-v1-abc.mp4');
        expect(runEngine).toHaveBeenCalledTimes(1);
        expect(vi.mocked(runEngine).mock.calls[0][0]).toContain('visuals-source');
    });
    it('serves live person masks through a narrow local URL', async () => {
        vi.mocked(runEngine).mockResolvedValueOnce({ code: 0, out: JSON.stringify({ plate: join(home, 'p', 'renders', '__live-v1-abc.mp4'), mask: { dir: join(home, 'p', 'cache/person-masks/0123456789abcdefabcd/masks'), fps: 15, count: 150 } }) });
        const r = await request('/api/projects/p/versions/v1/visual-source?matte=1');
        expect(r.status).toBe(200);
        const d = await r.json();
        expect(d.plan.mask).toEqual({ fps: 15, count: 150, url: '/api/projects/p/visual-masks/0123456789abcdefabcd/' });
        expect(vi.mocked(runEngine).mock.calls[0][0]).toContain('--matte');
    });
    it('does not expose arbitrary files as live preview assets', async () => {
        for (const url of ['/api/projects/p/visual-assets/project.json', '/api/projects/p/visual-masks/other/project.json'])
            expect((await request(url)).status).toBe(404);
    });
    it('ships six actual style packs and twenty effects', async () => { const c = await visualCatalog(); expect(c.styles).toHaveLength(6); expect(new Set(c.effects.map((e: any) => e.id)).size).toBe(20); });
    it('reads legacy cuts with their existing settings intact', async () => { await writeFile(join(home, 'p', 'style.json'), JSON.stringify({ accent: '#123456', spellings: { acme: 'ACME' } })); const d = await (await request(url)).json(); expect(d.config.preset).toBe('original'); expect(d.config.rev).toBe(0); });
    it('saves a new settings revision without changing the EDL', async () => { const r = await save(); expect(r.status).toBe(200); expect((await r.json()).config.rev).toBe(1); expect(await readFile(join(home, 'p', 'cuts', 'v1', 'visuals.json'), 'utf8')).toContain('snap-zoom'); });
    it('edits CLI settings that have no desk revision yet', async () => { await writeFile(join(home, 'p', 'cuts', 'v1', 'visuals.json'), JSON.stringify(good)); expect((await save()).status).toBe(200); });
    it('saves reusable style defaults while retaining caption and spelling settings', async () => { await writeFile(join(home, 'p', 'style.json'), JSON.stringify({ accent: '#123456', spellings: { acme: 'ACME' } })); const d = await (await request(url)).json(); const settings = { ...good, accent: '#abcdef', motion: 'subtle' }; expect((await request(url, { rev: 0, settings, timelineRev: d.timelineRev, applyToProject: true })).status).toBe(200); const style = JSON.parse(await readFile(join(home, 'p', 'style.json'), 'utf8')); expect(style.spellings.acme).toBe('ACME'); expect(style.visual_defaults).toEqual({ preset: 'volt', motion: 'subtle', accent: '#abcdef' }); });
    it('refuses stale revisions and stale timelines', async () => { const d = await (await request(url)).json(); expect((await save()).status).toBe(200); expect((await save()).status).toBe(409); await writeFile(join(home, 'p', 'cuts', 'v1', 'timeline.json'), JSON.stringify({ duration: 11, segments: [] })); expect((await save(good, 1, d.timelineRev)).status).toBe(400); });
    it('serialises two simultaneous saves so neither silently overwrites the other', async () => { const [a, b] = await Promise.all([save(), save()]); expect([a.status, b.status].sort()).toEqual([200, 409]); });
    it('refuses unknown effects and effects outside the cut', async () => { expect((await save({ ...good, effects: [{ ...good.effects[0], type: 'not-real' }] })).status).toBe(400); expect((await save({ ...good, effects: [{ ...good.effects[0], at: 9 }] })).status).toBe(400); });
    it('resolves a source anchor and refuses removed footage', async () => { const e = { ...good.effects[0], anchor: { source: 'a', time: 41, occurrence: 0 } }; const r = await save({ ...good, effects: [e] }); expect((await r.json()).config.effects[0].at).toBe(6); expect((await save({ ...good, effects: [{ ...e, anchor: { source: 'a', time: 99 } }] }, 1)).status).toBe(400); });
    it('does not invent chart values', async () => { expect((await save({ ...good, effects: [{ ...good.effects[0], type: 'growth-curve' }] })).status).toBe(400); });
    it('requires an uploaded asset and rejects path traversal', async () => {
        for (const asset of ['../secret.mp4', '/etc/passwd', 'uploads/missing.png'])
            expect((await save({ ...good, effects: [{ ...good.effects[0], type: 'b-roll-overlay', asset }] })).status).toBe(400);
    });
    it('does not render an unsaved cut', async () => { const r = await request('/api/projects/p/versions/v1/visual-render', { preview: true, at: 0, rev: 0 }); expect(r.status).toBe(400); });
    it('starts only one render when two requests arrive together', async () => {
        await save();
        let finish!: (r: {
            code: number;
            out: string;
        }) => void;
        vi.mocked(runEngine).mockImplementationOnce(() => new Promise(r => { finish = r; }));
        const [a, b] = await Promise.all([request('/api/projects/p/versions/v1/visual-render', { preview: true, at: 0, rev: 1 }), request('/api/projects/p/versions/v1/visual-render', { preview: true, at: 0, rev: 1 })]);
        expect([a.status, b.status].sort()).toEqual([202, 400]);
        expect(runEngine).toHaveBeenCalledTimes(1);
        finish({ code: 0, out: '' });
    });
    it('handles short versions and rejects version traversal', () => { expect(visualCut(home, 'p', 'v2.s1')).toBe(join(home, 'p', 'cuts', 'v2', 'shorts', 's1')); expect(() => visualCut(home, '../p', 'v1')).toThrow(); expect(() => visualCut(home, 'p', '../v1')).toThrow(); });
});
