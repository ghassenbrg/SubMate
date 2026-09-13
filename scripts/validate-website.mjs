import { access, readFile } from 'node:fs/promises';
import { resolve, dirname, normalize } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const websiteDir = resolve(root, 'website');
const pages = [
  'index.html',
  'installation.html',
  'features.html',
  'configuration.html',
  'platforms.html',
  'ai-translation.html',
  'development.html',
  'contributing.html',
  'privacy.html',
  'publishing.html',
];

const localReferences = /(?:href|src)=["']([^"']+)["']/g;
for (const page of pages) {
  const pagePath = resolve(websiteDir, page);
  const html = await readFile(pagePath, 'utf8');
  if (!/<meta name="viewport"/.test(html)) {
    throw new Error(`${page} is missing a responsive viewport declaration`);
  }
  if (!/<meta name="description"/.test(html)) {
    throw new Error(`${page} is missing a description`);
  }

  for (const match of html.matchAll(localReferences)) {
    const reference = match[1];
    if (/^(?:https?:|mailto:|#)/.test(reference)) continue;
    const localPath = normalize(resolve(dirname(pagePath), reference));
    if (!localPath.startsWith(`${websiteDir}/`)) {
      throw new Error(`${page} references a path outside website/: ${reference}`);
    }
    await access(localPath);
  }
}

console.log(`Validated ${pages.length} SubMate website pages and local assets`);
