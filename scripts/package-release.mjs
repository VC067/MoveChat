import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { createFirefoxManifest } from './firefox-manifest.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
// Source archives must describe the code actually built, not a dirty checkout.
assert.equal(git(['status', '--porcelain', '--untracked-files=normal']), '', 'Commit or set aside source changes before packaging a release.');
const commit = git(['rev-parse', 'HEAD']);
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
assert.match(version, /^\d+\.\d+\.\d+$/);
const output = path.join(root, 'release-artifacts', `v${version}`);
await mkdir(output, { recursive: true });
const date = new Date('2000-01-01T00:00:00.000Z');
const files = new Map();
const add = (zip, name, contents) => zip.file(name, contents, { date, createFolders: false, unixPermissions: 0o100644 });

async function walk(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    if (entry.name.startsWith('.')) continue;
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(full, name);
    else files.set(name, await readFile(full));
  }
}
await walk(path.join(root, 'dist'));
const chromeManifest = JSON.parse(files.get('manifest.json').toString('utf8'));
assert.equal(chromeManifest.version, version);
for (const name of ['index.html', 'content.js', 'background.js']) assert.ok(files.has(name), `Missing ${name}`);
assert.match(files.get('content.js').toString('utf8'), /^\(\(\) => \{/);
const checksums = [];

async function saveZip(zip, name) {
  const bytes = await zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX', compression: 'DEFLATE', compressionOptions: { level: 9 } });
  const validated = await JSZip.loadAsync(bytes, { checkCRC32: true });
  assert.ok(Object.keys(validated.files).every(file => !file.startsWith('/') && !file.includes('\\') && !file.split('/').includes('..')));
  await writeFile(path.join(output, name), bytes);
  checksums.push(`${createHash('sha256').update(bytes).digest('hex')}  ${name}`);
  console.log(`Validated ${name} (${bytes.length} bytes)`);
}

for (const browser of ['chrome', 'firefox']) {
  const zip = new JSZip();
  for (const [name, bytes] of files) add(zip, name, bytes);
  if (browser === 'firefox') {
    const manifest = createFirefoxManifest(chromeManifest);
    assert.equal(manifest.browser_specific_settings.gecko.id, 'movechat@vc067.github.io');
    add(zip, 'manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  }
  await saveZip(zip, `movechat-${browser}-v${version}.zip`);
}

// Deliberate allowlist: never package local captures, credentials, old binary
// ZIPs, browser profiles, node_modules, or the private local review report.
const rootSources = new Set([
  'package.json', 'package-lock.json', 'vite.config.ts', 'vitest.config.ts',
  'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json', 'postcss.config.js',
  'tailwind.config.js', 'eslint.config.js', 'index.html', 'LICENSE', 'README.md',
  'CHANGELOG.md', 'TESTING.md', 'RELEASING.md', 'build-firefox.js', 'create_icons.js',
]);
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean).sort();
const sourceZip = new JSZip();
for (const name of tracked) {
  if (rootSources.has(name) || /^(src|public|patches|scripts|tests)\//.test(name)) {
    if (name.split('/').some(part => part.startsWith('.'))) continue;
    add(sourceZip, name, await readFile(path.join(root, name)));
  }
}
const instructions = `# MoveChat v${version}: reviewer build instructions

Source commit: ${commit}
Build environment used: Node.js ${process.version}, ${process.platform}/${process.arch}.
Use Node.js 26.7.0 (or a compatible recent Node.js 24.15+/26+).

1. Extract this archive into an empty directory. No credentials are needed.
2. Run npm ci. The postinstall step applies patches/jspdf+4.2.1.patch.
3. Run npm test.
4. Run npm run build:firefox:test.
5. Compare the files in dist-firefox-test/ to the extracted Firefox release ZIP.
   For Chrome, compare dist/ to the extracted Chrome release ZIP.

The Firefox manifest conversion is in scripts/firefox-manifest.mjs.
The Vite configuration explicitly uses the patched jsPDF ES build and wraps the
content script so reinjection does not redeclare top-level lexical bindings.
No source obfuscation, external build service, API keys or private packages are used.
This source archive intentionally has no .git metadata. The build:release command
requires a clean Git checkout and is not needed to reproduce the extension files.
`;
add(sourceZip, 'BUILD_INSTRUCTIONS.md', instructions);
await saveZip(sourceZip, `movechat-source-v${version}.zip`);
await writeFile(path.join(output, 'BUILD_INSTRUCTIONS.md'), instructions);
await writeFile(path.join(output, 'SHA256SUMS.txt'), checksums.join('\n') + '\n');
await writeFile(path.join(output, 'BUILD_INFO.json'), JSON.stringify({ version, commit, node: process.version, platform: process.platform, arch: process.arch }, null, 2) + '\n');
const notes = (await readFile(path.join(root, 'CHANGELOG.md'), 'utf8')).replace(/^# Changelog\s*/, '');
await writeFile(path.join(output, 'RELEASE_NOTES.md'), notes);
console.log(`Release artifacts built from ${commit}: ${output}`);
