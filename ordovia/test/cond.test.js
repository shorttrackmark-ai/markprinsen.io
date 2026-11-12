// The rule builder reads and writes ordinary formulas. Loaded without a browser: only its pure parts are used.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { FB } from '../src/lib.js';

// load public/js/cond.js with a minimal window.FB.ui
const sandbox = { window: { FB: { ...FB, ui: { esc: (s) => s, $: () => null, $$: () => [] } } }, console };
sandbox.window.FB = Object.assign(sandbox.window.FB, {});
vm.runInNewContext(fs.readFileSync(new URL('../public/js/cond.js', import.meta.url), 'utf8'), { ...sandbox, window: sandbox.window });
const C = sandbox.window.FB.cond;

test('simple rules round-trip between formula and builder', () => {
  for (const f of ['days > 3', 'type == "Other"', 'total_incl >= 1000.5', 'NOT(ISEMPTY(supplier))', 'ISEMPTY(remarks)', 'approved', 'NOT(approved)', 'CONTAINS(item, "laptop")', 'needed_by < TODAY()']) {
    const p = C.parse(f);
    assert.ok(p && p.rows.length === 1, f);
    assert.equal(C.toExpr(p.rows, p.joiner), f);
  }
});

test('several parts are joined with and / or; mixed ones fall back to the formula', () => {
  const a = C.parse('days > 3 and type != "Sick"');
  assert.equal(a.rows.length, 2); assert.equal(a.joiner, 'and');
  assert.equal(C.toExpr(a.rows, a.joiner), 'days > 3 and type != "Sick"');
  const o = C.parse('a == 1 or b == 2'); assert.equal(o.joiner, 'or');
  assert.equal(C.parse('a == 1 and b == 2 or c == 3'), null);
  assert.equal(C.parse('ROUND(total) > 3'), null, 'anything beyond the builder is left as a formula');
  const empty = C.parse(''); assert.equal(empty.rows.length, 0); assert.equal(empty.joiner, 'and');
});

test('the formulas the builder writes evaluate correctly', () => {
  const rows = [{ key: 'days', op: 'gt', value: '3' }, { key: 'type', op: 'ne', value: 'Sick' }];
  const expr = C.toExpr(rows, 'and');
  assert.equal(FB.expr.truthy(FB.expr.evaluate(expr, { days: 5, type: 'Vacation' })), true);
  assert.equal(FB.expr.truthy(FB.expr.evaluate(expr, { days: 2, type: 'Vacation' })), false);
  assert.equal(FB.expr.truthy(FB.expr.evaluate(C.toExpr([{ key: 'x', op: 'empty', value: '' }], 'and'), { x: '' })), true);
  assert.equal(FB.expr.check(C.toExpr([{ key: 'name', op: 'contains', value: 'a "quoted" word' }], 'and')), null);
});

test('incomplete parts are skipped', () => {
  assert.equal(C.toExpr([{ key: 'days', op: 'gt', value: '' }], 'and'), '');
});
