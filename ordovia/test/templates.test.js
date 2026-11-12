// Every template must be a valid, runnable process: same checks as an AI answer, no lint issues once resolved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FB } from '../src/lib.js';
import { advance } from '../src/engine.js';
import { planBundle, resolve } from '../src/bundle.js';
import { TEMPLATES, PACKS } from '../src/templates.js';

const empty = () => ({ areas: [], tags: [], personFields: [], forms: [], people: [], flows: [] });

test('there are templates in every pack, with unique ids', () => {
  assert.ok(TEMPLATES.length >= 10);
  assert.equal(new Set(TEMPLATES.map(t => t.id)).size, TEMPLATES.length);
  for (const p of PACKS) assert.ok(TEMPLATES.some(t => t.pack === p), 'pack without templates: ' + p);
});

for (const t of TEMPLATES) {
  test('template “' + t.name + '” checks out and can run', () => {
    const { errors, plan } = planBundle(JSON.parse(JSON.stringify(t.bundle)), empty());
    assert.deepEqual(errors, [], t.id);
    const formIds = new Map(plan.forms.map((f, i) => [f.name.toLowerCase(), 100 + i]));
    const tagIds = new Map(plan.tags.map((x, i) => [(x.category + ': ' + x.value).toLowerCase(), 500 + i]));
    const { forms, flows } = resolve(plan, formIds, tagIds);
    const all = forms.map((f, i) => ({ id: 100 + i, name: f.name, slug: f.slug, fields: f.fields, status: 'active', is_class: f.is_class ? 1 : 0 }));
    for (const fl of flows) {
      assert.deepEqual(FB.logic.lintFlow(fl.graph, all.map(f => f.id), all), [], 'lint ' + fl.name);
      // every path reaches an end: walk the graph from the start
      const byId = Object.fromEntries(fl.graph.nodes.map(n => [n.id, n]));
      const seen = new Set(), stack = ['n1'];
      while (stack.length) { const id = stack.pop(); if (seen.has(id)) continue; seen.add(id); for (const e of fl.graph.edges.filter(x => x.from === id)) stack.push(e.to); }
      assert.ok([...seen].some(id => byId[id].type === 'end'), 'no end reachable in ' + fl.name);
      assert.equal(seen.size, fl.graph.nodes.length, 'unreachable steps in ' + fl.name);
      // the start works: the engine reaches the first task (or an end) without getting stuck
      const proc = { id: 1, flowName: fl.name, graph: fl.graph, vars: { initiator: { name: 'Test' }, process: fl.name, subject: { id: 1, interval_days: 30, label: 'M' } }, title: '', status: 'running' };
      const tasks = [];
      advance(proc, 'n1', { now: () => '2026-01-01 00:00:00', forms: new Map(all.map(f => [f.id, f])), describe: () => '', log() {}, createTask: (x) => tasks.push(x), createRecord() {}, updateRecord() {}, webhook() {} });
      assert.notEqual(proc.status, 'stuck', fl.name + ' got stuck at the start');
    }
  });
}
