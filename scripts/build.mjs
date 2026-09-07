import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const outdir = resolve(root, 'dist');
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
  target: 'chrome138',
  outdir,
  sourcemap: true,
  minify: false,
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

console.log(`Built FlixTranslate into ${outdir}`);
