import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findForbiddenNativeTokens } from './web-bundle-rules.mjs';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const files = readdirSync(dist, { recursive: true })
  .filter((name) => typeof name === 'string' && name.endsWith('.js'));
const bundle = files.map((name) => readFileSync(join(dist, name), 'utf8')).join('\n');
const found = findForbiddenNativeTokens(bundle);

if (found.length > 0) {
  throw new Error(`网页版包含原生模块：${found.join(', ')}`);
}

console.log('网页版未包含原生模块');
