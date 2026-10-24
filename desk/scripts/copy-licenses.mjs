import {createHash} from 'node:crypto';
import {mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// Browser bundles do not retain node_modules or their license files. Copy exact
// upstream notices after both Vite builds, and fail the build if one is missing.
const desk = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(desk, '..');
const output = join(desk, 'web-dist', 'licenses');
const notices = [];

async function add(file, source, name, version, url) {
  const bytes = await readFile(source);
  if (!bytes.length) throw new Error(`Empty license: ${relative(root, source)}`);
  notices.push({file, name, version, source: relative(root, source), url,
    sha256: createHash('sha256').update(bytes).digest('hex'), bytes});
}

async function dependency(base, name, license, url) {
  const directory = join(root, base, 'node_modules', name);
  const metadata = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  await add(`${name.replaceAll('/', '-').replaceAll('@', '')}-${license}`,
    join(directory, license), name, metadata.version, url);
}

const deskPackage = JSON.parse(await readFile(join(desk, 'package.json'), 'utf8'));
await add('Yap-Machine-LICENSE.txt', join(root, 'LICENSE'), 'Yap Machine', deskPackage.version, '');
await add('Yap-Machine-NOTICE.txt', join(root, 'NOTICE'), 'Yap Machine acknowledgments', '', '');
await add('Desk-NOTICE.txt', join(desk, 'NOTICE'), 'Desk acknowledgments', '', '');
await add('Style-Studio-LICENSE.txt', join(root, 'studio', 'STYLE-STUDIO-LICENSE'),
  'Style Studio engine', '1d4f96b8ee1c95720691e05a54f510dde7a164cd',
  'https://github.com/kelano86/style-studio-engine');
await dependency('desk', 'preact', 'LICENSE', 'https://preactjs.com');
await dependency('desk', '@fontsource/geist-sans', 'LICENSE', 'https://github.com/vercel/geist-font');
await dependency('desk', '@fontsource/geist-mono', 'LICENSE', 'https://github.com/vercel/geist-font');
await dependency('studio', 'react', 'LICENSE', 'https://react.dev');
await dependency('studio', 'react-dom', 'LICENSE', 'https://react.dev');
await dependency('studio', 'scheduler', 'LICENSE', 'https://github.com/facebook/react');
await dependency('studio', 'remotion', 'LICENSE.md', 'https://www.remotion.dev/license');
await dependency('studio', '@remotion/player', 'LICENSE.md', 'https://www.remotion.dev/license');

// qrcode-generator 2.0.4 publishes its copyright/MIT declaration in its JS
// header, but omits a separate full license. Retain the exact upstream text.
const qr = JSON.parse(await readFile(join(desk, 'node_modules/qrcode-generator/package.json'), 'utf8'));
await add('qrcode-generator-LICENSE.txt', join(desk, 'licenses/qrcode-generator-LICENSE.txt'),
  'qrcode-generator', qr.version, 'https://github.com/kazuhikoarase/qrcode-generator/blob/master/LICENSE');
const fonts = join(root, 'studio/public/fonts');
for (const family of (await readdir(fonts)).sort()) {
  for (const file of (await readdir(join(fonts, family))).sort()) {
    if (file.endsWith('-OFL.txt')) {
      await add(`fonts/${file}`, join(fonts, family, file), file.replace('-OFL.txt', ''),
        'vendored with Style Studio engine', 'https://openfontlicense.org');
    }
  }
}

// Read and validate everything before replacing the previous build's notices.
await rm(output, {recursive: true, force: true});
await mkdir(output, {recursive: true});
for (const {file, bytes} of notices) {
  await mkdir(dirname(join(output, file)), {recursive: true});
  await writeFile(join(output, file), bytes);
}
await writeFile(join(output, 'manifest.json'), JSON.stringify(
  notices.map(({bytes, ...metadata}) => metadata), null, 2) + '\n');
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
await writeFile(join(output, 'index.html'), `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Yap Machine — licenses and acknowledgments</title>
<style>body{max-width:800px;margin:48px auto;padding:0 24px;font:16px/1.6 system-ui;color:#242624;background:#faf9f6}li{margin:12px 0}a{color:#35592a}small{color:#565a55}</style>
<h1>Licenses and acknowledgments</h1>
<p>Yap Machine's own code is MIT licensed. Its dependencies and fonts retain their own licenses.</p>
<p>Remotion uses the <a href="https://www.remotion.dev/license">Remotion License</a>, not MIT. Eligibility and commercial-use conditions apply. The exact installed license is linked below.</p>
<ul>${notices.map(({file, name, version}) => `<li><a href="${escape(file)}">${escape(name)}</a>${version ? ` <small>${escape(version)}</small>` : ''}</li>`).join('\n')}</ul>
<p><a href="manifest.json">Source versions and SHA-256 checksums</a></p></html>\n`);
console.log(`Retained ${notices.length} license and notice files in web-dist/licenses/.`);
