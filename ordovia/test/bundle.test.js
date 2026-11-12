// The AI bundle: what an AI answer may contain, and that nothing wrong gets through.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FB } from '../src/lib.js';
import { advance } from '../src/engine.js';
import { extractJSON, planBundle, resolve } from '../src/bundle.js';

const ctx = () => ({
  areas: [{ id: 1, name: 'People & HR' }],
  tags: [{ id: 1, category: 'Function', value: 'Manager' }, { id: 2, category: 'Department', value: 'Sales' }],
  personFields: [{ key: 'job_title', label: 'Job title', type: 'select', options: ['Metrologist', 'Manager'] }],
  forms: [{ id: 9, name: 'Approval', status: 'active', is_class: 0, fields: [{ key: 'decision', type: 'radio', options: ['Approve', 'Reject'] }] }, { id: 10, name: 'Machine', status: 'active', is_class: 1, fields: [{ key: 'name', type: 'text' }] }],
  people: [{ id: 5, name: 'Eva Mulder' }],
  flows: [],
});

const LEAVE = {
  area: 'People & HR',
  forms: [{ name: 'Leave request', fields: [
    { key: 'start_date', label: 'First day', type: 'date', required: true, default: 'TODAY()', width: 'half' },
    { key: 'end_date', label: 'Last day', type: 'date', required: true, width: 'half' },
    { key: 'days', label: 'Working days', type: 'calc', formula: 'WORKDAYS(start_date, end_date)' },
  ] }],
  processes: [{
    name: 'Leave request', description: 'Ask for days off', purpose: 'Register leave', owner_role: 'HR', request_form: 'Leave request',
    title: '"Leave " & initiator.name',
    steps: [
      { id: 'check', type: 'decision', name: 'More than 3 days?', branches: [{ label: 'Yes', when: 'days > 3', to: 'approve' }, { label: 'No', to: 'done' }] },
      { id: 'approve', type: 'task', name: 'Manager approval', form: 'Approval', who: { type: 'tags', tags: ['Function: Manager'], same_as_initiator: ['Department'] }, due_hours: 48, next: 'verdict' },
      { id: 'verdict', type: 'decision', name: 'Approved?', branches: [{ label: 'Yes', when: 'decision == "Approve"', to: 'done' }, { label: 'No', to: 'no' }] },
      { id: 'done', type: 'end', name: 'Approved' },
      { id: 'no', type: 'end', name: 'Rejected' },
    ],
  }],
};

test('extractJSON copes with fences, chatter and smart quotes', () => {
  assert.deepEqual(extractJSON('Here you go:\n```json\n{"a": 1,}\n```\nHope it helps'), { a: 1 });
  assert.deepEqual(extractJSON('{ “a”: “b” }'), { a: 'b' });
  assert.throws(() => extractJSON('no json here'), /cannot find the JSON/);
  assert.throws(() => extractJSON('{ "a": }'), /not valid/);
  assert.throws(() => extractJSON(''), /Paste the answer/);
});

test('a good leave process becomes a plan, and the plan runs in the engine', () => {
  const { errors, warnings, plan } = planBundle(LEAVE, ctx());
  assert.deepEqual(errors, []);
  assert.equal(plan.forms.length, 1);
  assert.equal(plan.flows[0].graph.nodes[0].type, 'start');
  assert.deepEqual(plan.tags, []);
  const { forms, flows } = resolve(plan, new Map([['leave request', 100], ['approval', 9], ['machine', 10]]), new Map([['function: manager', 1]]));
  const g = flows[0].graph;
  assert.equal(g.nodes[0].formId, 100);
  assert.equal(g.nodes.find(n => n.name === 'Manager approval').assignee.tagIds[0], 1);
  assert.deepEqual(FB.logic.lintFlow(g, [100, 9, 10], [{ id: 100, fields: forms[0].fields }, { id: 9, fields: [] }]), []);
  // run it for real: 7 days -> manager task -> approve -> end "Approved"
  const formMap = new Map([[100, { id: 100, name: 'Leave request', fields: forms[0].fields }], [9, { id: 9, name: 'Approval', fields: [] }]]);
  const proc = { id: 1, flowName: 'Leave request', graph: g, vars: { initiator: { name: 'Bram' }, process: 'x', days: 7 }, title: '', status: 'running' };
  const tasks = [], io = { now: () => '2026-01-01 00:00:00', forms: formMap, describe: () => '', log() {}, createTask: (t) => tasks.push(t), createRecord() {}, updateRecord() {}, webhook() {} };
  advance(proc, 'n1', io);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].name, 'Manager approval');
  proc.vars.decision = 'Approve';
  advance(proc, tasks[0].nodeId, io);
  assert.equal(proc.status, 'done');
  assert.equal(proc.vars.outcome, 'Approved');
  assert.ok(warnings.every(w => typeof w === 'string'));
});

test('short leave goes straight to the end', () => {
  const { plan } = planBundle(LEAVE, ctx());
  const { flows, forms } = resolve(plan, new Map([['leave request', 100], ['approval', 9]]), new Map());
  const proc = { id: 1, flowName: 'L', graph: flows[0].graph, vars: { initiator: {}, process: 'x', days: 2 }, title: '', status: 'running' };
  const tasks = [];
  advance(proc, 'n1', { now: () => '2026-01-01 00:00:00', forms: new Map(), describe: () => '', log() {}, createTask: (t) => tasks.push(t), createRecord() {}, updateRecord() {}, webhook() {} });
  assert.equal(tasks.length, 0);
  assert.equal(proc.vars.outcome, 'Approved');
  assert.ok(forms.length === 1);
});

test('wrong answers are refused with plain messages', () => {
  const bad = (mutate) => { const b = JSON.parse(JSON.stringify(LEAVE)); mutate(b); return planBundle(b, ctx()).errors.join(' | '); };
  assert.match(bad(b => { b.processes[0].steps[1].next = 'nowhere'; }), /not a step/);
  assert.match(bad(b => { b.processes[0].steps[1].type = 'webhook'; }), /webhook steps are not created/);
  assert.match(bad(b => { b.forms[0].fields[2].formula = 'WORKDAYS(start_date,'; }), /formula|field/i);
  assert.match(bad(b => { b.forms[0].fields[0].key = 'First Day'; }), /key must be/);
  assert.match(bad(b => { b.forms[0].fields[1].key = 'start_date'; }), /used twice/);
  assert.match(bad(b => { b.processes[0].steps[1].form = 'Nonexistent'; }), /does not exist/);
  assert.match(bad(b => { b.processes[0].steps[3].type = 'teleport'; }), /does not exist/);
  assert.match(bad(b => { b.processes[0].steps = b.processes[0].steps.filter(s => s.type !== 'end'); b.processes[0].steps[1].next = 'verdict'; b.processes[0].steps[2].branches = [{ label: 'a', to: 'approve' }, { label: 'b', to: 'check' }]; b.processes[0].steps[0].branches = [{ label: 'a', to: 'approve' }, { label: 'b', to: 'verdict' }]; }), /at least one end/);
  assert.match(bad(b => { b.processes[0].steps[0].branches[0].when = 'days >'; }), /branch/);
  assert.match(bad(b => { b.processes[0].steps[1].who = { type: 'attribute', attribute: 'Shoe size', value: '42' }; }), /does not exist/);
  assert.match(bad(b => { b.processes[0].request_form = 'Missing form'; }), /request form/);
  assert.equal(planBundle(null, ctx()).errors.length, 1);
  assert.equal(planBundle({}, ctx()).errors.length, 1);
});

test('names are matched to the workspace; missing tags are listed for creation; attributes and people resolve', () => {
  const b = JSON.parse(JSON.stringify(LEAVE));
  b.processes[0].steps[1].who = { type: 'tags', tags: ['function: manager', 'Location: Rotterdam'] };
  b.processes[0].who_can_start = ['Function: Manager'];
  const { errors, plan } = planBundle(b, ctx());
  assert.deepEqual(errors, []);
  assert.deepEqual(plan.tags, [{ category: 'Location', value: 'Rotterdam' }]);
  const c = JSON.parse(JSON.stringify(LEAVE));
  c.processes[0].steps[1].who = { type: 'attribute', attribute: 'job title', value: 'Metrologist' };
  assert.deepEqual(planBundle(c, ctx()).plan.flows[0].graph.nodes.find(n => n.name === 'Manager approval').assignee, { type: 'attr', key: 'job_title', label: 'Job title', value: 'Metrologist' });
  const d = JSON.parse(JSON.stringify(LEAVE));
  d.processes[0].steps[1].who = { type: 'person', person: 'eva mulder' };
  assert.equal(planBundle(d, ctx()).plan.flows[0].graph.nodes.find(n => n.name === 'Manager approval').assignee.personId, 5);
});

test('a process can work on a class, and update its object', () => {
  const b = {
    processes: [{ name: 'Calibrate', works_on: 'Machine', steps: [
      { id: 'a', type: 'task', name: 'Measure', who: 'initiator', next: 'b' },
      { id: 'b', type: 'record', name: 'Update machine', form: 'Machine', mode: 'update', set: ['name = subject.name'], next: 'c' },
      { id: 'c', type: 'end', name: 'Done' }] }],
  };
  const { errors, plan } = planBundle(b, ctx());
  assert.deepEqual(errors, []);
  const { flows } = resolve(plan, new Map([['machine', 10]]), new Map());
  assert.equal(flows[0].graph.nodes[0].subjectForm, 10);
  assert.equal(flows[0].graph.nodes.find(n => n.type === 'record').recordId, 'subject.id');
  const notClass = JSON.parse(JSON.stringify(b)); notClass.processes[0].works_on = 'Approval';
  assert.match(planBundle(notClass, ctx()).errors.join(), /not a class/);
});
