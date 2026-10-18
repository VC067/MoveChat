import { access, cp, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createFirefoxManifest } from './firefox-manifest.mjs';

const root = new URL('../', import.meta.url);
const source = new URL('dist/', root);
const destination = new URL('dist-firefox-test/', root);
const marker = new URL('.movechat-firefox-test-build', root);
const ownership = 'Generated MoveChat Firefox test build; safe for this script to replace.\n';

// Keep the tracked store ZIPs untouched. This is an unsigned, local test copy.
const exists = await access(destination).then(() => true, error => {
  if (error.code === 'ENOENT') return false;
  throw error;
});
if (exists) {
  const previous = await readFile(marker, 'utf8').catch(() => '');
  if (previous !== ownership) throw new Error('Refusing to replace an unmanaged dist-firefox-test folder. Choose a different output folder first.');
  // Only replace the generated folder this script owns; stale hashed bundles
  // must not accumulate or Firefox validation would scan outdated code too.
  await rm(destination, { recursive: true });
}
await cp(source, destination, {
  recursive: true,
  filter: path => !path.endsWith('.DS_Store'),
});
const manifest = createFirefoxManifest(JSON.parse(await readFile(new URL('manifest.json', source), 'utf8')));
await writeFile(new URL('manifest.json', destination), JSON.stringify(manifest, null, 2) + '\n');
await writeFile(marker, ownership);
console.log(`Unsigned Firefox test copy: ${fileURLToPath(destination)}`);
console.log('Load manifest.json temporarily through about:debugging. No store ZIPs were changed.');
