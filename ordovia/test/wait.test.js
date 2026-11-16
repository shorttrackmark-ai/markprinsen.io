// A "Wait" step: the case stops, remembers when to continue, and goes on from that step later.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FB } from '../src/lib.js';
import { advance } from '../src/engine.js';

const graph = (wait) => ({
  nodes: [{ id: 's', type: 'start', name: 'Start' }, { id: 'w', type: 'wait', name: 'Cooling off', ...wait }, { id: 'e', type: 'end', name: 'Done' }],
  edges: [{ id: 'e1', from: 's', to: 'w' }, { id: 'e2', from: 'w', to: 'e' }],
});
const io = (timers, log) => ({ now: () => '2026-01-01 08:00:00', forms: new Map(), describe: () => '', log: (m) => log.push(m), createTask() {}, createRecord() {}, updateRecord() {}, createTimer: (t) => timers.push(t), webhook() {} });

test('the case waits and a timer is set', () => {
  const timers = [], log = [], proc = { id: 1, flowName: 'F', graph: graph({ waitAmount: 3, waitUnit: 'days' }), vars: {}, title: 'T', status: 'running' };
  advance(proc, 's', io(timers, log));
  assert.equal(proc.status, 'running', 'not finished');
  assert.deepEqual(timers, [{ nodeId: 'w', name: 'Cooling off', wakeAt: '2026-01-04 08:00:00' }]);
  assert.ok(log.some(m => /Waiting 3 days at “Cooling off”/.test(m)));
});
test('hours work too, and nothing less than one', () => {
  const timers = [];
  advance({ id: 1, graph: graph({ waitAmount: 5, waitUnit: 'hours' }), vars: {}, title: '', status: 'running' }, 's', io(timers, []));
  assert.equal(timers[0].wakeAt, '2026-01-01 13:00:00');
  const t2 = [];
  advance({ id: 1, graph: graph({ waitAmount: 0, waitUnit: 'days' }), vars: {}, title: '', status: 'running' }, 's', io(t2, []));
  assert.equal(t2[0].wakeAt, '2026-01-02 08:00:00');
});
test('when the time is over the case continues from the wait step', () => {
  const proc = { id: 1, graph: graph({ waitAmount: 1, waitUnit: 'days' }), vars: {}, title: '', status: 'running' };
  advance(proc, 'w', io([], []));
  assert.equal(proc.status, 'done'); assert.equal(proc.vars.outcome, 'Done');
});
test('a place without timers (the example seeder) passes straight through', () => {
  const proc = { id: 1, graph: graph({ waitAmount: 2, waitUnit: 'days' }), vars: {}, title: '', status: 'running' };
  const plain = io([], []); delete plain.createTimer;
  advance(proc, 's', plain);
  assert.equal(proc.status, 'done');
});
test('the process check asks for a waiting time', () => {
  const g = graph({ waitAmount: 0 });
  assert.ok(FB.logic.lintFlow(g, [], []).some(e => /Wait step “Cooling off” needs a waiting time/.test(e)));
  assert.deepEqual(FB.logic.lintFlow(graph({ waitAmount: 2, waitUnit: 'days' }), [], []), []);
});
