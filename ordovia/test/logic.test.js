// Run with: npm test   (Node 20+; no Cloudflare account needed)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FB, makeDirectory } from '../src/lib.js';
import { advance } from '../src/engine.js';

test('expressions: arithmetic, logic, dates, dotted names', () => {
  const E = FB.expr;
  assert.equal(E.evaluate('quantity * unit_price', { quantity: 2, unit_price: 700 }), 1400);
  assert.equal(E.evaluate('IF(total > 1000, "Finance", "Manager")', { total: 1694 }), 'Finance');
  assert.equal(E.evaluate('days > 3 and type != "Sick"', { days: 7, type: 'Vacation' }), true);
  assert.equal(E.evaluate('WORKDAYS("2026-12-07", "2026-12-15")'), 7);
  assert.equal(E.evaluate('supplier.country', { 'supplier.country': 'Netherlands' }), 'Netherlands');
  assert.equal(E.evaluate('initiator.department', { initiator: { department: 'Sales' } }), 'Sales');
  assert.equal(E.check('days > ('), 'Unexpected end of expression');
  assert.throws(() => E.evaluate('alert(1)'), /Unknown function/);
});

const purchase = {
  fields: [
    { key: 'supplier', type: 'record', recordForm: 1, required: true },
    { key: 'quantity', type: 'number', required: true, min: 1 },
    { key: 'unit_price', type: 'number', required: true },
    { key: 'total', type: 'calc', formula: 'quantity * unit_price' },
    { key: 'vat', type: 'calc', formula: 'IF(supplier.country == "Netherlands", ROUND(total * 0.21, 2), 0)' },
    { key: 'note', type: 'text', required: true, visibleIf: 'total > 1000' },
  ],
  checks: [{ rule: 'supplier.approved', message: 'Supplier not approved' }],
};
const suppliers = { 7: { label: 'NL BV', data: { country: 'Netherlands', approved: true } }, 8: { label: 'Cheap', data: { country: 'Other', approved: false } } };
const lookup = (f, id) => suppliers[id] || null;

test('server-side form pipeline recomputes calculations and ignores tampering', () => {
  const r = FB.logic.finalize(purchase, { supplier: 7, quantity: 2, unit_price: 100, total: 1, vat: 999 }, {}, lookup);
  assert.equal(r.ok, true);
  assert.equal(r.data.total, 200);
  assert.equal(r.data.vat, 42);
  assert.equal(r.data.note, null); // hidden field is cleared
  assert.equal(r.data.supplier_label, 'NL BV');
});

test('required-when-visible, min, invalid lookups and form-level checks', () => {
  assert.deepEqual(Object.keys(FB.logic.finalize(purchase, { supplier: 7, quantity: 0, unit_price: 600 }, {}, lookup).errors), ['quantity']);
  assert.ok(FB.logic.finalize(purchase, { supplier: 7, quantity: 2, unit_price: 600 }, {}, lookup).errors.note);
  assert.equal(FB.logic.finalize(purchase, { supplier: 99, quantity: 1, unit_price: 1 }, {}, lookup).errors.supplier, 'Invalid choice.');
  assert.deepEqual(FB.logic.finalize(purchase, { supplier: 8, quantity: 1, unit_price: 1 }, {}, lookup).formErrors, ['Supplier not approved']);
});

test('flow lint finds structural problems', () => {
  const g = { nodes: [{ id: 's', type: 'start', name: 'Start' }, { id: 't', type: 'task', name: 'Do it' }, { id: 'x', type: 'end', name: 'Orphan' }], edges: [{ id: 'e', from: 's', to: 't' }] };
  const errs = FB.logic.lintFlow(g, []);
  assert.ok(errs.some(e => e.includes('no form')));
  assert.ok(errs.some(e => e.includes('no outgoing arrow')));
  assert.ok(errs.some(e => e.includes('never be reached')));
});

test('engine: decisions, calculations, records and routing to the initiator\'s manager', () => {
  const D = makeDirectory(
    [{ id: 1, name: 'Bram', active: 1 }, { id: 2, name: 'Anna', active: 1 }, { id: 3, name: 'Daan', active: 1 }],
    [{ id: 10, category: 'Function', value: 'Manager' }, { id: 20, category: 'Department', value: 'Sales' }, { id: 21, category: 'Department', value: 'Ops' }],
    [{ person_id: 1, tag_id: 20 }, { person_id: 2, tag_id: 10 }, { person_id: 2, tag_id: 20 }, { person_id: 3, tag_id: 10 }, { person_id: 3, tag_id: 21 }]);
  const rule = { type: 'tags', tagIds: [10], sameAs: ['Department'] };
  const inst = { started_by: 1, vars: {} };
  assert.equal(D.matches(2, rule, inst), true);  // Anna: manager in Sales
  assert.equal(D.matches(3, rule, inst), false); // Daan: manager, but Ops

  const register = { id: 5, name: 'Register', slug: 'register', fields: [{ key: 'amount', type: 'number' }, { key: 'double', type: 'calc', formula: 'amount * 2' }] };
  const graph = { nodes: [
    { id: 's', type: 'start', name: 'Start' },
    { id: 'c', type: 'action', name: 'Calc', assignments: 'amount = days * 100' },
    { id: 'd', type: 'decision', name: 'Big?' },
    { id: 't', type: 'task', name: 'Approve', formId: 1, assignee: rule },
    { id: 'r', type: 'record', name: 'Log', formId: 5, mapping: 'amount = amount' },
    { id: 'e', type: 'end', name: 'Done' },
  ], edges: [
    { from: 's', to: 'c' }, { from: 'c', to: 'd' },
    { from: 'd', to: 't', condition: 'amount > 300' }, { from: 'd', to: 'r' },
    { from: 't', to: 'e' }, { from: 'r', to: 'e' },
  ] };
  const run = (days) => {
    const log = { tasks: [], records: [], events: [] };
    const proc = { id: 1, graph, vars: { days }, title: 'x', status: 'running' };
    advance(proc, 's', { now: () => '2026-01-01 00:00:00', forms: new Map([[5, register]]), describe: () => '', log: (m) => log.events.push(m),
      createTask: (t) => log.tasks.push(t), createRecord: (f, d) => log.records.push(d), updateRecord() {}, webhook() {} });
    return { proc, log };
  };
  const big = run(5);
  assert.equal(big.log.tasks[0].name, 'Approve');
  assert.equal(big.proc.status, 'running');
  const small = run(2);
  assert.deepEqual(small.log.records[0], { amount: 200, double: 400 }); // target form's calculation applied
  assert.equal(small.proc.status, 'done');
  assert.equal(small.proc.vars.outcome, 'Done');
});
