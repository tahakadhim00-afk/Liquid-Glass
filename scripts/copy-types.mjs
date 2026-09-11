/**
 * Copy the hand-written type declarations next to the built bundle.
 *
 * Vite's library mode emits JS only, so the .d.ts has to be placed
 * alongside it for `exports.types` to resolve. A copy step rather than a
 * generator: the declarations are hand-written, so there is nothing to
 * generate from.
 */
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const from = resolve(root, 'src/lib/index.d.ts');
const to = resolve(root, 'dist-lib/index.d.ts');

await mkdir(dirname(to), { recursive: true });
await copyFile(from, to);
console.log('copied index.d.ts -> dist-lib/');
