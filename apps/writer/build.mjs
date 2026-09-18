// Build do servidor do Writer (bundle CJS único).
//
// Roda como `npm run build` no apps/writer. Empacota o servidor num
// único writer.cjs que pode ser executado com `node` (web) ou
// `require()`d pelo app Electron. O js-yaml é "aliasado" para o seu
// build CommonJS (index.js): assim tanto o ESM de desenvolvimento
// (tsx) quanto o bundle CJS conversam com a mesma implementação.

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const dir = fileURLToPath(new URL('.', import.meta.url));
const nodeRequire = createRequire(import.meta.url);
const jsYamlMain = nodeRequire.resolve('js-yaml');

if (!jsYamlMain.endsWith('.cjs.js') && !jsYamlMain.endsWith('index.js')) {
  throw new Error(`Esperado build CommonJS do js-yaml; veio: ${jsYamlMain}`);
}

await esbuild.build({
  entryPoints: [path.join(dir, 'src/server/standalone.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['electron'],
  alias: { 'js-yaml': jsYamlMain },
  outfile: path.join(dir, 'dist/writer.cjs'),
  logLevel: 'info',
});