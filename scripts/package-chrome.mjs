import archiver from 'archiver';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const extensionDir = resolve(root, 'dist', 'chrome');
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const packagesDir = resolve(root, 'dist', 'packages');
const filename = `submate-chrome-v${packageJson.version}.zip`;
const outputPath = resolve(packagesDir, filename);

await mkdir(packagesDir, { recursive: true });
await rm(outputPath, { force: true });

const output = createWriteStream(outputPath);
const archive = archiver('zip', { zlib: { level: 9 } });

const complete = new Promise((resolvePromise, rejectPromise) => {
  output.on('close', resolvePromise);
  output.on('error', rejectPromise);
  archive.on('error', rejectPromise);
});

archive.pipe(output);
// The extension files must be at the root of the ZIP, not nested in dist/chrome.
archive.directory(extensionDir, false);
await archive.finalize();
await complete;

console.log(`Packaged Chrome extension: ${outputPath} (${archive.pointer()} bytes)`);
