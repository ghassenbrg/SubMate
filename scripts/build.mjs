import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const target = process.argv[2] ?? 'chrome';
const targetConfig = {
  chrome: {
    minimumVersion: 'chrome138',
  },
};

if (!(target in targetConfig)) {
  throw new Error(`Unsupported build target: ${target}. Available targets: ${Object.keys(targetConfig).join(', ')}`);
}

const distDir = resolve(root, 'dist');
const outdir = resolve(distDir, target);
// Remove only the legacy flat Chrome output left by builds before dist/chrome.
// Keep target directories and release packages so future platforms remain isolated.
for (const entry of ['_locales', 'background', 'content', 'icons', 'manifest.json', 'options.html', 'page', 'popup.html', 'ui']) {
  await rm(resolve(distDir, entry), { recursive: true, force: true });
}
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

const entries = {
  'page/netflix-manifest-agent': 'src/page/netflix-manifest-agent.ts',
  'content/bootstrap': 'src/content/bootstrap.ts',
  'background/service-worker': 'src/background/service-worker.ts',
  'ui/popup': 'src/ui/popup/popup.ts',
  'ui/options': 'src/ui/options/options.ts',
};

await build({
  absWorkingDir: root,
  entryPoints: entries,
  bundle: true,
  format: 'iife',
  target: targetConfig[target].minimumVersion,
  outdir,
  sourcemap: false,
  minify: true,
  legalComments: 'eof',
});

for (const file of ['manifest.json', 'popup.html', 'options.html']) {
  await cp(resolve(root, 'public', file), resolve(outdir, file));
}
for (const file of ['ui/popup.css', 'ui/options.css']) {
  await mkdir(dirname(resolve(outdir, file)), { recursive: true });
  await cp(resolve(root, 'public', file), resolve(outdir, file));
}
await cp(resolve(root, 'public', '_locales'), resolve(outdir, '_locales'), { recursive: true });
await cp(resolve(root, 'public', 'icons'), resolve(outdir, 'icons'), { recursive: true });

console.log(`Built FlixTranslate (${target}) into ${outdir}`);
