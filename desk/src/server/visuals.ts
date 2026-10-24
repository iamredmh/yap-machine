import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Hono } from 'hono';
import { z } from 'zod';
import { InvalidError, NotFoundError, RevConflictError } from '../core/errors.js';
import { runEngine } from '../core/engine.js';
import { readProject, readVersion } from '../core/workspace.js';
import { contentType, mediaSecurityHeaders, sendFile } from './files.js';
const anchor = z.object({ source: z.string().min(1), time: z.number().finite().min(0), occurrence: z.number().int().min(0).default(0) });
export const EffectSchema = z.object({
    id: z.string().regex(/^[\w-]{1,80}$/), type: z.string(), at: z.number().finite().min(0), duration: z.number().finite().min(.1).max(60),
    strength: z.number().finite().min(.25).max(2).default(1), enabled: z.boolean().default(true), text: z.string().max(180).default(''),
    items: z.array(z.string().trim().min(1).max(80)).max(8).default([]), values: z.array(z.number().finite().min(-1e12).max(1e12)).max(12).default([]),
    asset: z.string().optional(), anchor: anchor.optional(),
});
export const VisualSchema = z.object({
    preset: z.enum(['original', 'volt', 'ledger', 'sketch', 'terminal', 'glass', 'pop']).default('original'),
    motion: z.enum(['subtle', 'balanced', 'bold']).default('balanced'), accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    effects: z.array(EffectSchema).max(100).default([]),
});
type Visual = z.infer<typeof VisualSchema>;
const here = dirname(fileURLToPath(import.meta.url));
let cachedCatalog: any;
export async function visualCatalog(): Promise<any> {
    if (cachedCatalog)
        return cachedCatalog;
    const p = process.env.YAP_STUDIO ? join(process.env.YAP_STUDIO, 'catalog.json') : resolve(here, '../../../studio/catalog.json');
    if (existsSync(p))
        return cachedCatalog = JSON.parse(await readFile(p, 'utf8'));
    const r = await runEngine(['visuals-catalog']);
    if (r.code)
        throw new InvalidError('The styles renderer is missing from this installation.');
    return cachedCatalog = JSON.parse(r.out);
}
export function visualCut(home: string, project: string, version: string): string {
    if (!/^[\w-]+$/.test(project) || !/^v\d+(\.s\d+)?$/.test(version))
        throw new InvalidError('Choose a valid project and cut');
    const [v, s] = version.split('.');
    return s ? join(home, project, 'cuts', v, 'shorts', s) : join(home, project, 'cuts', v);
}
async function json(path: string, fallback: any) {
    try {
        return JSON.parse(await readFile(path, 'utf8'));
    }
    catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT')
            return fallback;
        throw e;
    }
}
async function atomic(path: string, value: unknown) {
    const temp = path + '.' + randomUUID() + '.tmp';
    await writeFile(temp, JSON.stringify(value, null, 2) + '\n');
    await rename(temp, path);
}
export async function validateVisual(home: string, id: string, version: string, settings: Visual): Promise<Visual> {
    const dir = visualCut(home, id, version), tl = await json(join(dir, 'timeline.json'), null);
    if (!tl)
        throw new NotFoundError('cut', version);
    const cat = await visualCatalog(), types = new Map<string, any>(cat.effects.map((e: any) => [e.id, e]));
    const ids = new Set<string>();
    for (const e of settings.effects) {
        if (ids.has(e.id))
            throw new InvalidError('Each effect needs a unique id');
        ids.add(e.id);
        const type = types.get(e.type);
        if (!type)
            throw new InvalidError('Choose a known effect');
        let at = e.at;
        if (e.anchor) {
            const matches = tl.segments.filter((s: any) => s.source === e.anchor!.source && s.start <= e.anchor!.time && s.end > e.anchor!.time);
            const s = matches[e.anchor.occurrence];
            if (!s)
                throw new InvalidError(`${type.name} targets footage removed from this cut. Place it again.`);
            at = e.anchor.time - s.start + s.out_start;
            e.at = at;
        }
        if (at >= tl.duration || at + e.duration > tl.duration + .001)
            throw new InvalidError(`${type.name} runs past the end of the cut`);
        if (!e.enabled)
            continue;
        if (['checklist', 'checklist-pop', 'headline-storm'].includes(e.type) && !e.items.length)
            throw new InvalidError('Add the words you want this effect to show');
        if (e.type === 'growth-curve' && e.values.length < 2)
            throw new InvalidError('Add at least two real values for the growth curve');
        if (e.type === 'zoom-through-cut' && !tl.segments.slice(1).some((s: any) => s.out_start >= at && s.out_start < at + e.duration))
            throw new InvalidError('Place Zoom through cut across an edit boundary');
        if (type.asset) {
            if (!e.asset || !/^uploads\/[\w.-]+$/.test(e.asset) || !['.png', '.jpg', '.jpeg', '.webp', '.mp4', '.mov', '.webm', '.m4v'].includes(extname(e.asset).toLowerCase()))
                throw new InvalidError('Choose an uploaded image or video');
            const file = resolve(home, id, e.asset);
            const root = resolve(home, id, 'uploads');
            const real = await import('node:fs/promises').then(m => m.realpath(file)).catch(() => null);
            if (!real || !real.startsWith(root + '/'))
                throw new InvalidError('That effect asset is no longer available');
        }
    }
    return settings;
}
type RenderJob = {
    id: string;
    project: string;
    version: string;
    revision: number;
    timelineRev: string;
    state: 'running' | 'done' | 'failed';
    preview: boolean;
    lines: string[];
    file?: string;
    message?: string;
};
export function installVisuals(app: Hono, home: string, emit: (e: {
    type: string;
    [k: string]: unknown;
}) => void) {
    const queues = new Map<string, Promise<unknown>>(), jobs = new Map<string, RenderJob>();
    const sources = new Map<string, Promise<any>>();
    const locked = async <T>(key: string, fn: () => Promise<T>) => {
        const before = queues.get(key) ?? Promise.resolve();
        let release!: () => void;
        const done = new Promise<void>(r => { release = r; });
        queues.set(key, before.catch(() => { }).then(() => done));
        await before.catch(() => { });
        try {
            return await fn();
        }
        finally {
            release();
        }
    };
    const target = async (id: string, v: string) => {
        const cut = visualCut(home, id, v);
        if (!await readProject(home, id) || !await readVersion(home, id, v))
            throw new NotFoundError('cut', v);
        return cut;
    };
    app.get('/api/visuals/catalog', async (c) => c.json(await visualCatalog()));
    app.get('/api/projects/:p/versions/:v/visual-source', async (c) => {
        const id = c.req.param('p'), v = c.req.param('v'), cut = await target(id, v);
        const raw = await readFile(join(cut, 'timeline.json'), 'utf8');
        const timelineRev = createHash('sha256').update(raw).digest('hex');
        const context=await Promise.all([join(home,id,'style.json'),join(home,id,'people.json'),join(cut,'edl.json')].map(p=>json(p,{})));
        const contextRev=createHash('sha256').update(JSON.stringify(context)).digest('hex');
        const matte = c.req.query('matte') === '1', key = `${cut}:${timelineRev}:${contextRev}:${matte}`;
        if (!sources.has(key)) {
            const pending = (async () => {
                const r = await runEngine(['visuals-source', v, '-p', join(home, id), ...(matte ? ['--matte'] : [])]);
                if (r.code)
                    throw new InvalidError(r.out.slice(-1200) || 'Could not prepare the live preview');
                const line = r.out.trim().split('\n').reverse().find(l => l.startsWith('{'));
                if (!line)
                    throw new InvalidError('The live preview source did not load');
                const plan = JSON.parse(line);
                const rel = relative(join(home, id), plan.plate).split('\\').join('/');
                if (!/^renders\/__live-[\w.-]+\.mp4$/.test(rel))
                    throw new InvalidError('Invalid preview source');
                plan.plate = `/media/${encodeURIComponent(id)}/${rel}`;
                if (plan.mask) {
                    const key = basename(dirname(plan.mask.dir));
                    if (!/^[a-f0-9]{20}$/.test(key))
                        throw new InvalidError('Invalid presenter masks');
                    const { fps, count } = plan.mask;
                    plan.mask = { fps, count, url: `/api/projects/${encodeURIComponent(id)}/visual-masks/${key}/` };
                }
                return { plan, timelineRev };
            })().catch(e => { sources.delete(key); throw e; });
            sources.set(key, pending);
            if (sources.size > 32) {
                const oldest = sources.keys().next().value;
                if (oldest && oldest !== key)
                    sources.delete(oldest);
            }
        }
        return c.json(await sources.get(key));
    });
    app.get('/api/projects/:p/visual-assets/:file', async (c) => {
        const id = c.req.param('p'), file = c.req.param('file');
        if (!/^[\w-]+$/.test(id) || !/^visual-[a-f0-9-]+\.(png|jpe?g|webp|mp4|mov|webm|m4v)$/i.test(file) || !await readProject(home, id))
            throw new NotFoundError('asset', file);
        const root = resolve(home, id, 'uploads'), path = await import('node:fs/promises').then(m => m.realpath(join(root, file))).catch(() => null);
        if (!path || !path.startsWith(root + '/'))
            throw new NotFoundError('asset', file);
        const res = await sendFile(path, c.req.header('range'), contentType(path));
        for (const [k, v] of Object.entries(mediaSecurityHeaders()))
            res.headers.set(k, v);
        return res;
    });
    app.get('/api/projects/:p/visual-masks/:key/:file', async (c) => {
        const id = c.req.param('p'), key = c.req.param('key'), file = c.req.param('file');
        if (!/^[\w-]+$/.test(id) || !/^[a-f0-9]{20}$/.test(key) || !/^\d{6}\.png$/.test(file) || !await readProject(home, id))
            throw new NotFoundError('mask', file);
        const root = resolve(home, id, 'cache/person-masks'), path = await import('node:fs/promises').then(m => m.realpath(join(root, key, 'masks', file))).catch(() => null);
        if (!path || !path.startsWith(root + '/'))
            throw new NotFoundError('mask', file);
        const res = await sendFile(path, undefined, 'image/png');
        for (const [k, v] of Object.entries(mediaSecurityHeaders()))
            res.headers.set(k, v);
        return res;
    });
    app.get('/api/projects/:p/versions/:v/visuals', async (c) => {
        const id = c.req.param('p'), v = c.req.param('v'), cut = await target(id, v);
        const style = await json(join(home, id, 'style.json'), {});
        const config = { rev: 0, ...await json(join(cut, 'visuals.json'), { schema: 1, preset: style.visual_style ?? 'original', motion: 'balanced', ...style.visual_defaults, effects: [] }) };
        const raw = await readFile(join(cut, 'timeline.json'), 'utf8');
        const timelineRev = createHash('sha256').update(raw).digest('hex');
        let result = null;
        for (const name of ['visual-export.json', 'visual-preview.json']) {
            const candidate = await json(join(cut, name), null);
            if (candidate && candidate.file === `renders/${v}-${candidate.preview ? 'styled-preview' : 'styled'}.mp4` && existsSync(join(home, id, candidate.file))) {
                result = candidate;
                break;
            }
        }
        const job = [...jobs.values()].find(j => j.project === id && j.version === v && j.state === 'running');
        return c.json({ config, timeline: await readVersion(home, id, v), timelineRev, result, job });
    });
    app.post('/api/projects/:p/versions/:v/visuals', async (c) => {
        const id = c.req.param('p'), v = c.req.param('v'), cut = await target(id, v);
        const b = z.object({ rev: z.number().int().min(0), settings: VisualSchema, applyToProject: z.boolean().default(false), timelineRev: z.string().min(1) }).parse(await c.req.json());
        return locked(cut, async () => {
            const old = await json(join(cut, 'visuals.json'), { rev: 0 });
            if ((old.rev ?? 0) !== b.rev)
                throw new RevConflictError('visuals.json', b.rev, old.rev ?? 0);
            const raw = await readFile(join(cut, 'timeline.json'), 'utf8');
            if (createHash('sha256').update(raw).digest('hex') !== b.timelineRev)
                throw new InvalidError('The cut changed. Reload it before saving these effects.');
            const settings = await validateVisual(home, id, v, b.settings);
            const config = { schema: 1, rev: b.rev + 1, ...settings };
            await atomic(join(cut, 'visuals.json'), config);
            if (b.applyToProject) {
                const p = join(home, id, 'style.json');
                const s = await json(p, {});
                const { preset, motion, accent } = settings;
                await atomic(p, { ...s, visual_style: preset, visual_defaults: { preset, motion, accent } });
            }
            emit({ type: 'project', project: id });
            return c.json({ config });
        });
    });
    app.post('/api/projects/:p/visual-assets', async (c) => {
        const id = c.req.param('p');
        if (!/^[\w-]+$/.test(id) || !await readProject(home, id))
            throw new NotFoundError('project', id);
        const form = await c.req.formData(), file = form.get('file');
        if (!(file instanceof File) || !file.size || file.size > 200 * 1024 * 1024)
            throw new InvalidError('Choose an image or video under 200 MB');
        const ext = extname(file.name).toLowerCase();
        if (!['.png', '.jpg', '.jpeg', '.webp', '.mp4', '.mov', '.webm', '.m4v'].includes(ext))
            throw new InvalidError('Choose a PNG, JPEG, WebP, MP4, MOV or WebM');
        const rel = `uploads/visual-${randomUUID()}${ext}`;
        await mkdir(join(home, id, 'uploads'), { recursive: true });
        await writeFile(join(home, id, rel), Buffer.from(await file.arrayBuffer()));
        sources.clear();
        return c.json({ asset: rel, name: file.name });
    });
    app.post('/api/projects/:p/versions/:v/visual-render', async (c) => {
        const id = c.req.param('p'), v = c.req.param('v');
        const cut = await target(id, v);
        const b = z.object({ preview: z.boolean().default(true), at: z.number().finite().min(0).default(0), rev: z.number().int().min(0) }).parse(await c.req.json());
        return locked(cut, async () => {
            if ([...jobs.values()].some(j => j.project === id && j.version === v && j.state === 'running'))
                throw new InvalidError('This cut is already rendering.');
            const config = await json(join(cut, 'visuals.json'), null);
            if (!config || config.rev !== b.rev)
                throw new InvalidError('Save these settings before rendering.');
            await validateVisual(home, id, v, VisualSchema.parse(config));
            const tl = await readVersion(home, id, v);
            if (b.at >= tl!.duration)
                throw new InvalidError('Preview start must be inside the cut');
            const jid = randomUUID();
            const timelineRev = createHash('sha256').update(await readFile(join(cut, 'timeline.json'), 'utf8')).digest('hex');
            const job: RenderJob = { timelineRev, id: jid, project: id, version: v, revision: config.rev, state: 'running', preview: b.preview, lines: [] };
            if (jobs.size >= 64) {
                const old = [...jobs.values()].find(j => j.state !== 'running');
                if (old)
                    jobs.delete(old.id);
            }
            // Snapshot the selected settings: later UI changes cannot alter a queued render.
            const settings = join(home, id, 'cache', `visual-settings-${jid}.json`);
            await mkdir(dirname(settings), { recursive: true });
            await atomic(settings, config);
            jobs.set(jid, job);
            const args = ['visuals', v, '-p', join(home, id), '--settings', settings, ...(b.preview ? ['--preview', '--at', String(b.at)] : [])];
            void runEngine(args, line => {
                job.lines.push(line);
                if (job.lines.length > 40)
                    job.lines.shift();
                emit({ type: 'job', project: id, id: jid, line });
            }).then(r => {
                job.state = r.code === 0 ? 'done' : 'failed';
                job.message = r.code === 0 ? undefined : r.out.slice(-2000);
                if (!r.code)
                    job.file = `renders/${v}-${b.preview ? 'styled-preview' : 'styled'}.mp4`;
                emit({ type: 'project', project: id });
            }).catch(e => { job.state = 'failed'; job.message = String(e); }).finally(() => unlink(settings).catch(() => { }));
            return c.json(job, 202);
        });
    });
    app.get('/api/visual-jobs/:id', c => {
        const j = jobs.get(c.req.param('id'));
        if (!j)
            throw new NotFoundError('render', c.req.param('id'));
        return c.json(j);
    });
}
