import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import type { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { InvalidError } from '../core/errors.js';
const MAX = 500 * 1024 * 1024;
const extensions = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.wav', '.mp3', '.m4a', '.aac']);
/** Keep the display name separate from the filesystem-safe project ID. */
export async function nameImportedProject(dir: string, requested?: string) {
  const name = requested?.trim().slice(0, 100);
  if (!name) return;
  const path = join(dir, 'project.json');
  const project = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(path, JSON.stringify({ ...project, name }, null, 2) + '\n');
}
/** Browser uploads are local copies. Folder imports continue referencing originals. */
export function installFootage(app: Hono, root: string, start: (footage: string, name?: string) => Promise<unknown>) {
  app.post('/api/footage', bodyLimit({ maxSize: MAX + 1024 * 1024, onError: c => c.json({ message: 'Choose up to 500 MB of footage, or import its folder instead.' }, 413) }), async c => {
    const form = await c.req.formData();
    const files = form.getAll('files').filter((f): f is File => f instanceof File);
    if (!files.length || files.length > 30) throw new InvalidError('Choose 1–30 video or audio files.');
    if (files.some(f => !f.size || !extensions.has(extname(f.name).toLowerCase()))) throw new InvalidError('Choose video or audio files: MP4, MOV, M4V, WebM, MKV, WAV, MP3, M4A or AAC.');
    if (files.reduce((n, f) => n + f.size, 0) > MAX) throw new InvalidError('Choose up to 500 MB of footage, or import its folder instead.');
    const imports = join(root, 'footage'); await mkdir(imports, { recursive: true });
    const dir = await mkdtemp(join(imports, 'import-'));
    const used = new Set<string>();
    try {
      for (const f of files) {
        const safe = basename(f.name).replace(/[^\w. -]/g, '_');
        let name = safe;
        for (let i = 2; used.has(name.toLowerCase()); i++) name = `${basename(safe, extname(safe))}-${i}${extname(safe)}`;
        used.add(name.toLowerCase());
        await writeFile(join(dir, name), Buffer.from(await f.arrayBuffer()), { flag: 'wx' });
      }
      const requested = form.get('name');
      const name = typeof requested === 'string' && requested.trim() ? requested.trim().slice(0, 100) : basename(files[0].name, extname(files[0].name));
      return c.json(await start(dir, name), 202);
    } catch (e) { await rm(dir, { recursive: true, force: true }); throw e; }
  });
}
