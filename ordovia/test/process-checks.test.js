// A process that cannot work must not be allowed to go live: the checks, in plain words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FB } from '../src/lib.js';

const N = (id, type, name, extra = {}) => ({ id, type, name, x: 0, y: 0, ...extra });
const E = (from, to, extra = {}) => ({ id: from + to, from, to, ...extra });
const lint = (nodes, edges) => FB.logic.lintFlow({ nodes, edges }, [1], [{ id: 1, fields: [] }]);

const good = () => ({
  nodes: [N('s', 'start', 'Start'), N('t', 'task', 'Fill in', { formId: 1 }), N('d', 'decision', 'Big?'), N('a', 'end', 'Approved'), N('r', 'end', 'Rejected')],
  edges: [E('s', 't'), E('t', 'd'), E('d', 'a', { condition: 'x > 1' }), E('d', 'r')],
});

test('a sound process has no problems', () => {
  const g = good();
  assert.deepEqual(lint(g.nodes, g.edges), []);
});

test('a decision needs exactly one otherwise path', () => {
  const g = good();
  g.edges = g.edges.map(e => (e.to === 'r' ? { ...e, condition: 'x < 1' } : e));
  assert.ok(lint(g.nodes, g.edges).some(e => /otherwise/.test(e) && /stuck/.test(e)));
  const h = good(); h.edges.push(E('d', 'a', { id: 'dup' }));
  assert.ok(lint(h.nodes, h.edges).some(e => /arrows without a rule/.test(e)));
});

test('a single arrow with a rule would strand the case when the rule is false', () => {
  const g = good(); g.edges = g.edges.map(e => (e.from === 't' ? { ...e, condition: 'x > 1' } : e));
  assert.ok(lint(g.nodes, g.edges).some(e => /only continues when its rule is true/.test(e)));
});

test('steps cut off from Start are found even when they are connected to each other', () => {
  const g = good();
  g.nodes.push(N('i1', 'task', 'Island one', { formId: 1 }), N('i2', 'task', 'Island two', { formId: 1 }));
  g.edges.push(E('i1', 'i2'), E('i2', 'i1'));
  const errs = lint(g.nodes, g.edges);
  assert.ok(errs.some(e => /“Island one” can never be reached from Start/.test(e)), errs.join(' | '));
});

test('a loop with no way out is refused', () => {
  const g = good();
  g.nodes.push(N('x', 'task', 'Again', { formId: 1 }), N('y', 'task', 'And again', { formId: 1 }));
  g.edges = g.edges.filter(e => e.to !== 'r').concat([E('d', 'x'), E('x', 'y'), E('y', 'x')]);
  const errs = lint(g.nodes, g.edges);
  assert.ok(errs.some(e => /can never finish/.test(e)), errs.join(' | '));
});

test('a correction loop that can leave is fine', () => {
  const g = good();
  g.nodes.push(N('fix', 'task', 'Correct', { formId: 1 }));
  g.edges = [E('s', 't'), E('t', 'd'), E('d', 'fix', { condition: 'bad' }), E('d', 'a'), E('fix', 't')];
  g.nodes = g.nodes.filter(n => n.id !== 'r');
  assert.deepEqual(lint(g.nodes, g.edges), []);
});
