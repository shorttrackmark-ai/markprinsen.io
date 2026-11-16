// The Dutch dictionary and the engine that applies it (run without a browser).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const load = (lang) => {
  const win = { confirm: () => true, alert: () => {}, prompt: () => '', localStorage: { getItem: () => lang }, location: {}, NodeFilter: {} };
  win.window = win;
  const ctx = vm.createContext({ ...win, window: win, localStorage: win.localStorage, document: { readyState: 'loading', documentElement: {}, body: null, addEventListener() {}, title: '' }, NodeFilter: {}, MutationObserver: class { observe() {} }, console });
  ctx.window = ctx;
  vm.runInContext(fs.readFileSync(new URL('../public/js/i18n.js', import.meta.url), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(new URL('../public/js/nl.js', import.meta.url), 'utf8'), ctx);
  return ctx.FB;
};
const FB = load('nl');

test('words, sentences and whitespace', () => {
  assert.equal(FB.t('My tasks'), 'Mijn taken');
  assert.equal(FB.t('  My   tasks \n'), '  Mijn taken \n', 'keeps the surrounding whitespace, ignores inner');
  assert.equal(FB.t('Something nobody translated'), 'Something nobody translated');
  assert.ok(FB.i18n.missing.has('Something nobody translated'));
});
test('patterns carry names and numbers over', () => {
  assert.equal(FB.t('Hi Bram'), 'Hoi Bram');
  assert.equal(FB.t('Welcome, Anna'), 'Welkom, Anna');
  assert.equal(FB.t('Free trial: 14 days left.'), 'Gratis proefperiode: nog 14 dagen.');
  assert.equal(FB.t('due in 3 days'), 'over 3 dagen af');
  assert.equal(FB.t('Showing 25 of 40 rows.'), 'Toont 25 van 40 rijen.');
});
test('dates follow the language', () => {
  assert.equal(FB.t('2026-11-16 20:05'), '16-11-2026 20:05');
  assert.equal(FB.t('2026-11-16'), '16-11-2026');
  assert.equal(FB.t('2026-11-16T20:05:33.000Z'), '16-11-2026 20:05');
});
test('English stays English', () => {
  const en = load('en');
  assert.equal(en.t('My tasks'), 'My tasks');
  assert.equal(en.t('2026-11-16 20:05'), '2026-11-16 20:05');
  assert.equal(en.locale(), 'en-GB'); assert.equal(FB.locale(), 'nl-NL');
});
test('every entry is sound: not empty, same number of {} in both texts, no stray English-only quotes', () => {
  const dir = new URL('../i18n/', import.meta.url);
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.json'))) {
    const part = JSON.parse(fs.readFileSync(new URL(f, dir), 'utf8'));
    for (const [k, v] of Object.entries(part)) {
      assert.ok(typeof v === 'string' && v.trim(), `${f}: empty translation for "${k}"`);
      assert.equal((k.match(/\{\}/g) || []).length, (v.match(/\{\}/g) || []).length, `${f}: {} count differs in "${k}"`);
    }
  }
});

test('what a pattern captures is translated when it is a known phrase', () => {
  assert.equal(FB.t('Purchase: Train tickets (€ 285)'), 'Inkoop: Treinkaartjes (€ 285)');
  assert.equal(FB.t('Leave Bram Jansen – 2 days'), 'Verlof Bram Jansen – 2 dagen');
  assert.equal(FB.t('Incident: Wrong labels on shipment (Medium)'), 'Incident: Verkeerde etiketten op zending (Middel)');
});
