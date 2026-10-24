import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { installFootage, nameImportedProject } from './footage.js';
let root: string, app: Hono;
const start = vi.fn(async (footage: string, name?: string) => ({ project: 'demo', footage, name, state: 'running' }));
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'yap-import-')); start.mockClear(); app = new Hono(); app.onError((e,c) => c.json({ message:e.message },400)); installFootage(app,root,start); });
afterEach(async () => { await rm(root,{recursive:true,force:true}); });
const upload = (files: File[], name = '') => { const f = new FormData(); for (const file of files) f.append('files',file); f.set('name',name); return app.request('http://localhost/api/footage',{method:'POST',body:f}); };
describe('footage import', () => {
  it('keeps footage locally and prepares a project with the requested name', async () => {
    const r = await upload([new File(['clip'],'take.mp4')], 'My video');
    expect(r.status).toBe(202); const d = await r.json();
    expect(start).toHaveBeenCalledWith(d.footage, 'My video');
    expect(await readFile(join(d.footage,'take.mp4'),'utf8')).toBe('clip');
  });
  it('preserves two files with the same name and confines filenames', async () => {
    const r = await upload([new File(['one'],'take.mov'),new File(['two'],'take.mov'),new File(['three'],'../camera.mp4')]);
    const d = await r.json();
    expect(await readdir(d.footage)).toEqual(['camera.mp4','take-2.mov','take.mov']);
    expect(await readFile(join(d.footage,'take-2.mov'),'utf8')).toBe('two');
  });
  it('rejects non-media and empty files without starting the engine', async () => {
    expect((await upload([new File(['script'],'bad.html')])).status).toBe(400);
    expect((await upload([new File([],'empty.mp4')])).status).toBe(400);
    expect(start).not.toHaveBeenCalled(); expect(await readdir(root)).toEqual([]);
  });
  it('cleans up a failed project creation without touching other imports', async () => {
    const good = await (await upload([new File(['first'],'one.mp4')])).json();
    start.mockRejectedValueOnce(new Error('Could not create project'));
    expect((await upload([new File(['second'],'two.mp4')])).status).toBe(400);
    expect(await readdir(join(root,'footage'))).toHaveLength(1);
    expect(await readFile(join(good.footage,'one.mp4'),'utf8')).toBe('first');
  });
});

describe('imported project names', () => {
  it('keeps the entered casing and punctuation without losing source metadata', async () => {
    const original = { footage: '/footage', sources: [{ id: 'camera', path: '/footage/take.mov' }] };
    await writeFile(join(root, 'project.json'), JSON.stringify(original));
    await nameImportedProject(root, '  My Q&A — Part 2  ');
    expect(JSON.parse(await readFile(join(root, 'project.json'), 'utf8'))).toEqual({ ...original, name: 'My Q&A — Part 2' });
  });
  it('leaves the engine default intact when no name was requested', async () => {
    const original = '{"name":"Original","sources":[]}';
    await writeFile(join(root, 'project.json'), original);
    await nameImportedProject(root, ' ');
    expect(await readFile(join(root, 'project.json'), 'utf8')).toBe(original);
  });
});
