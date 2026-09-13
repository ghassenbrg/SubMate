/**
 * Sends one real batch through the cloud translation client and prints what
 * came back, so a provider, model or prompt change can be checked against the
 * live API without loading the extension.
 *
 *   SUBMATE_API_KEY=... node scripts/cloud-smoke.mjs gemini
 *   SUBMATE_API_KEY=... node scripts/cloud-smoke.mjs openai gpt-5.6-luna ja ar
 *   node scripts/cloud-smoke.mjs custom llama3.3 ja ar http://localhost:11434/v1
 *
 * The key is read from the environment only, so it never lands in shell history
 * as an argument.
 */
import { build } from 'esbuild';
import { resolve } from 'node:path';

const [provider = 'gemini', model = '', source = 'ja', target = 'ar', baseUrl = ''] = process.argv.slice(2);
const root = resolve(import.meta.dirname, '..');

const { outputFiles } = await build({
  stdin: {
    contents: `
      export { buildPrompt, echoedIds, reconcileBatch } from './src/translation/cloud/batch';
      export { sendChat } from './src/translation/cloud/openai-compatible';
      export { resolveEndpoint } from './src/translation/cloud/providers';
    `,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const lib = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);

const endpoint = lib.resolveEndpoint({ cloudVendor: provider, cloudModel: model, cloudBaseUrl: baseUrl });
if (!endpoint) throw new Error(`Incomplete configuration for "${provider}" (custom needs a model and a base URL)`);

const cues = [
  { id: 'c000001', text: 'どうしたの？顔色が悪いよ。' },
  { id: 'c000002', text: '何でもない。ちょっと疲れただけ。' },
  { id: 'c000003', text: '♪～' },
  { id: 'c000004', text: '（ドアが開く音）' },
  { id: 'c000005', text: '明日の朝、駅で待ってるから。' },
];

const prompt = lib.buildPrompt({ sourceLanguage: source, targetLanguage: target, cues });
console.log(`→ ${endpoint.provider.label} · ${endpoint.model} · ${endpoint.baseUrl}`);
const started = Date.now();
const raw = await lib.sendChat({ endpoint, apiKey: process.env.SUBMATE_API_KEY ?? '', prompt });
console.log(`← ${Date.now() - started} ms\n\nRaw response:\n${raw}\n`);

const { translations, missing } = lib.reconcileBatch(raw, cues);
const echoed = lib.echoedIds(cues, translations, source, target);
for (const cue of cues) {
  const flag = missing.includes(cue.id) ? '  [missing]' : echoed.includes(cue.id) ? '  [untranslated]' : '';
  console.log(`${cue.text}\n  → ${translations.get(cue.id) ?? ''}${flag}`);
}
console.log(`\n${missing.length} missing, ${echoed.length} untranslated`);
