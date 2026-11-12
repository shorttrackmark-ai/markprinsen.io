// A process End step can notify an outside system that a case ended there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FB } from '../src/lib.js';
import { advance } from '../src/engine.js';

const graph = (notify) => ({
  nodes: [{ id: 'n1', type: 'start', name: 'Start' }, { id: 'n2', type: 'decision', name: 'Ok?', x: 0, y: 0 },
    { id: 'n3', type: 'end', name: 'Approved' }, { id: 'n4', type: 'end', name: 'Rejected', ...notify }],
  edges: [{ id: 'e1', from: 'n1', to: 'n2' }, { id: 'e2', from: 'n2', to: 'n3', label: 'Yes', condition: 'ok' }, { id: 'e3', from: 'n2', to: 'n4' }],
});
const run = (g, vars) => {
  const calls = [], logs = [];
  const proc = { id: 7, flowName: 'Leave request', graph: g, vars: { initiator: {}, process: 'Leave request', ...vars }, title: 'Leave Bram', status: 'running' };
  advance(proc, 'n1', { now: () => '2026-01-01 00:00:00', forms: new Map(), describe: () => '', log: (m) => logs.push(m), createTask() {}, createRecord() {}, updateRecord() {}, webhook: (...a) => calls.push(a) });
  return { proc, calls, logs };
};

test('an End with a notification sends it, with the outcome and the case', () => {
  const { proc, calls, logs } = run(graph({ notifyUrl: 'https://example.com/hook', notifyFormat: 'teams' }), { ok: false });
  assert.equal(proc.status, 'done');
  assert.equal(calls.length, 1);
  const [url, payload, format] = calls[0];
  assert.equal(url, 'https://example.com/hook');
  assert.equal(format, 'teams');
  assert.equal(payload.event, 'case.ended');
  assert.equal(payload.outcome, 'Rejected');
  assert.equal(payload.case.id, 7);
  assert.match(payload.text, /Rejected/);
  assert.ok(logs.some(l => /Notified example\.com/.test(l)));
});

test('an End without a notification sends nothing, and other outcomes are quiet', () => {
  assert.equal(run(graph({}), { ok: false }).calls.length, 0);
  assert.equal(run(graph({ notifyUrl: 'https://example.com/hook' }), { ok: true }).calls.length, 0);   // ended as Approved: no notification configured there
});

test('the designer check wants an https address', () => {
  const g = graph({ notifyUrl: 'http://insecure.example.com' });
  const errs = FB.logic.lintFlow(g, [], []);
  assert.ok(errs.some(e => /https/.test(e)), errs.join('|'));
  assert.ok(!FB.logic.lintFlow(graph({ notifyUrl: 'https://example.com/hook' }), [], []).some(e => /https/.test(e)));
});
