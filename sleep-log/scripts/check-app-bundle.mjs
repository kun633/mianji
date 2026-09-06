import { existsSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
assert.ok(existsSync('dist/index.html'), 'Build app assets first');
assert.ok(!existsSync('dist/sw.js'), 'Native APK must not ship/register a PWA service worker');
assert.ok(!readFileSync('dist/index.html', 'utf8').includes('manifest.webmanifest'), 'Native build must not use the web manifest');
assert.ok(existsSync('android/app/src/main/assets/native-cache-reset.js'), 'Native upgrade recovery asset missing');
console.log('Android assets: no PWA worker; upgrade recovery asset present');
