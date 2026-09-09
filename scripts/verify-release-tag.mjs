import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const tag = process.argv[2];
if (!tag) throw new Error('Usage: node scripts/verify-release-tag.mjs vX.Y.Z');

const root = resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const expectedTag = `v${packageJson.version}`;

if (tag !== expectedTag) {
  throw new Error(`Release tag ${tag} does not match package version ${packageJson.version}; expected ${expectedTag}`);
}

console.log(`Release tag ${tag} matches package version ${packageJson.version}`);
