import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {bundle} from '@remotion/bundler';
import {openBrowser, selectComposition, renderMedia, renderStill} from '@remotion/renderer';

const root = path.dirname(fileURLToPath(import.meta.url));
const [manifest, output, still] = process.argv.slice(2);
if (!manifest || !output) throw new Error('render.mjs <manifest.json> <output.mp4> [still-frame]');
const input = JSON.parse(fs.readFileSync(manifest, 'utf8'));
// An array is the integration-test batch format; normal exports use one plan.
const jobs = Array.isArray(input) ? input.map(j=>({...j,output:path.join(output,j.output)})) : [{props:input,output,frame:still}];
const token = crypto.randomBytes(24).toString('hex');
const media = new Map();
const masks = new Map();
let origin = '';
const register = (file) => {
  const id = `m${media.size}${path.extname(file).toLowerCase()}`;
  media.set(id, file);
  return `${origin}/${token}/${id}`;
};
const server = http.createServer((req, res) => {
  const prefix = `/${token}/`;
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith(prefix)) { res.writeHead(404).end(); return; }
  const name = url.pathname.slice(prefix.length);
  let file = media.get(name);
  const mask = /^(mask\d+)\/(\d{6}\.png)$/.exec(name);
  if (!file && mask && masks.has(mask[1])) file = path.join(masks.get(mask[1]), mask[2]);
  if (!file || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
  const size = fs.statSync(file).size;
  const ext = path.extname(file).toLowerCase();
  const type = ({'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.webm':'video/webm','.mov':'video/quicktime'})[ext] ?? 'video/mp4';
  const headers = {'content-type':type,'accept-ranges':'bytes','access-control-allow-origin':'*','cache-control':'private, max-age=3600'};
  const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
  if (match) {
    const start = Number(match[1]), end = Math.min(size-1, match[2] ? Number(match[2]) : size-1);
    if (start > end || start >= size) { res.writeHead(416, {'content-range':`bytes */${size}`}).end(); return; }
    res.writeHead(206, {...headers,'content-length':end-start+1,'content-range':`bytes ${start}-${end}/${size}`});
    fs.createReadStream(file,{start,end}).pipe(res);
  } else {
    res.writeHead(200,{...headers,'content-length':size});
    fs.createReadStream(file).pipe(res);
  }
});
await new Promise((ok,fail) => { server.once('error',fail); server.listen(0,'127.0.0.1',ok); });
origin = `http://127.0.0.1:${server.address().port}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(),'yap-visuals-'));
const candidates = [process.env.YAP_BROWSER, process.env.BROWSER,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta'];
const browserExecutable = candidates.find(p => p && fs.existsSync(p)) ?? null;
let browser;
try {
  const serveUrl = await bundle({entryPoint:path.join(root,'src/yap/entry.tsx'), publicDir:path.join(root,'public'), outDir:path.join(tmp,'bundle')});
  browser = await openBrowser('chrome',{browserExecutable});
  for (const job of jobs) {
    const props=job.props;
    props.hero=props.accent;
    props.plate=register(props.plate);
    for (const e of props.effects) if(e.asset)e.asset=register(e.asset);
    if(props.mask){const id=`mask${masks.size}`;masks.set(id,props.mask.dir);props.mask.url=`${origin}/${token}/${id}/`;}
    fs.mkdirSync(path.dirname(job.output),{recursive:true});
    const common = {serveUrl,inputProps:props,browserExecutable,puppeteerInstance:browser,timeoutInMilliseconds:90000};
    const composition = await selectComposition({...common,id:'YapVisuals'});
    if (job.frame !== undefined) {
      await renderStill({...common,composition,output:job.output,frame:Number(job.frame),imageFormat:'png'});
    } else {
      let last=-1;
      await renderMedia({...common,composition,outputLocation:job.output,codec:'h264',audioCodec:'aac',crf:18,concurrency:2,
        onProgress:({progress}) => {const n=Math.floor(progress*10);if(n!==last){last=n;console.log(`Styles and effects: ${n*10}%`);}}});
    }
    if(jobs.length>1)console.log(`Verified ${path.basename(job.output)}`);
  }
} catch(e) {
  console.error(e?.stack ?? e);
  process.exitCode=1;
} finally {
  await browser?.close({silent:true}).catch(()=>{});
  server.closeAllConnections();
  await new Promise(ok=>server.close(ok));
  fs.rmSync(tmp,{recursive:true,force:true});
}
