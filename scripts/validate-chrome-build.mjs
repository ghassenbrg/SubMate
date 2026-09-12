import { access, readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const extensionDir = resolve(root, 'dist', 'chrome');
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const manifestPath = resolve(extensionDir, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

const requiredFiles = [
  'manifest.json',
  'background/service-worker.js',
  'content/bootstrap.js',
  'page/netflix-manifest-agent.js',
  'page/tver-media-agent.js',
  'page/prime-media-agent.js',
  'popup.html',
  'options.html',
  'ui/popup.js',
  'ui/options.js',
  'ui/popup.css',
  'ui/options.css',
  '_locales/en/messages.json',
  'icons/icon-128.png',
];

const missing = [];
for (const file of requiredFiles) {
  try {
    await access(resolve(extensionDir, file));
  } catch {
    missing.push(file);
  }
}

if (missing.length > 0) {
  throw new Error(`Chrome build is missing required file(s): ${missing.join(', ')}`);
}

if (manifest.manifest_version !== 3) {
  throw new Error(`Expected Manifest V3, received manifest_version ${manifest.manifest_version}`);
}
if (manifest.version !== packageJson.version) {
  throw new Error(`Version mismatch: package.json is ${packageJson.version}, manifest.json is ${manifest.version}`);
}
if (!manifest.background?.service_worker || !manifest.action?.default_popup) {
  throw new Error('Manifest must declare a background service worker and action popup');
}

const topLevelFiles = await readdir(extensionDir, { recursive: true });
const sourceMaps = topLevelFiles.filter((file) => file.endsWith('.map'));
if (sourceMaps.length > 0) {
  throw new Error(`Production build must not include source maps: ${sourceMaps.join(', ')}`);
}

console.log(`Validated Chrome Manifest V3 build ${manifest.version} at ${extensionDir}`);
