// Puts a fresh version on every script and stylesheet address in public/index.html, so a browser never mixes old and new files after a deploy.
import { readFileSync, writeFileSync } from 'node:fs';
const f = new URL('../public/index.html', import.meta.url);
const v = Date.now().toString(36);
const html = readFileSync(f, 'utf8').replace(/((?:src|href)="(?:js|css)\/[\w.-]+\.(?:js|css))(?:\?v=\w+)?"/g, `$1?v=${v}"`);
writeFileSync(f, html);
console.log('stamped', v);
