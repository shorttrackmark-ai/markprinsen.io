// Every help text has a Dutch version.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { hasText } from '../src/localize.js';

test('help per screen: every sentence is translated', () => {
  const doc = { addEventListener() {}, body: { classList: { contains: () => false } } };
  const win = { FB: { ui: { esc: (s) => s, $: () => null, modal: () => null } }, document: doc };
  win.window = win;
  vm.runInNewContext(fs.readFileSync(new URL('../public/js/help.js', import.meta.url), 'utf8'), { ...win, window: win, document: doc });
  const sentences = [];
  for (const [, title, intro, steps] of win.FB.helpTexts) sentences.push(title, intro, ...steps);
  sentences.push(...win.FB.helpGeneral);
  const missing = [...new Set(sentences)].filter(s => !hasText(s));
  assert.deepEqual(missing, [], 'translate: ' + JSON.stringify(missing, null, 1));
});
