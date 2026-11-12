// The standard web-form rules, checked the same way on the screen and on the server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FB } from '../src/lib.js';

const check = (field, value, ctx = {}) => {
  const f = { key: 'x', label: 'X', ...field };
  const res = FB.logic.finalize({ fields: [f], checks: [] }, { x: value }, ctx, () => null);
  return res.errors.x || '';
};

test('mandatory, minimum and maximum length', () => {
  assert.match(check({ type: 'text', required: true }, ''), /required/);
  assert.match(check({ type: 'text', minLength: 5 }, 'abc'), /at least 5/);
  assert.equal(check({ type: 'text', minLength: 5 }, 'abcde'), '');
  assert.match(check({ type: 'textarea', maxLength: 10 }, 'this is far too long'), /at most 10/);
  assert.equal(check({ type: 'text', minLength: 5 }, ''), '', 'an optional empty field is not checked');
});

test('numbers: minimum, maximum, whole numbers', () => {
  assert.match(check({ type: 'number', min: 1 }, 0), /Minimum is 1/);
  assert.match(check({ type: 'number', max: 5 }, 6), /Maximum is 5/);
  assert.match(check({ type: 'number', integer: true }, 2.5), /Whole/);
});

test('dates: earliest and latest as formulas', () => {
  const day = (n) => FB.expr.evaluate(`ADDDAYS(TODAY(), ${n})`, {});
  assert.match(check({ type: 'date', minDate: 'TODAY()' }, day(-3)), /cannot be before/);
  assert.equal(check({ type: 'date', minDate: 'TODAY()' }, day(2)), '');
  assert.match(check({ type: 'date', maxDate: 'ADDDAYS(TODAY(), 30)' }, day(60)), /cannot be after/);
  assert.equal(check({ type: 'date', maxDate: 'ADDDAYS(TODAY(), 30)' }, day(10)), '');
});

test('format and pattern still apply; the builder check rejects broken date formulas', () => {
  assert.match(check({ type: 'text', pattern: '^[A-Z]{3}-[0-9]{4}$' }, 'abc'), /format/);
  assert.equal(check({ type: 'text', pattern: '^[A-Z]{3}-[0-9]{4}$' }, 'ABC-1234'), '');
  assert.ok(FB.logic.lint({ fields: [{ key: 'd', type: 'date', minDate: 'TODAY(' }], checks: [] }).some(p => /minDate/.test(p)));
});
