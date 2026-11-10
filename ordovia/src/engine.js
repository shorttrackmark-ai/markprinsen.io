// Ordovia process engine.
// The core is pure: it walks the flowchart and reports what should happen through an `io`
// object. The API turns that into one atomic D1 batch; the demo seeder keeps it in memory.
import { FB } from './lib.js';

/**
 * io = {
 *   now(), log(message, personId), describe(rule), forms: Map<id, form>,
 *   createTask({nodeId, name, formId, assignee, dueAt}),
 *   createRecord(form, data), updateRecord(form, id, patch),
 *   webhook(url, payload)
 * }
 * proc = { id, flowName, graph, vars, title, status, started_by, finished_at }
 */
export function advance(proc, fromNodeId, io) {
  const g = proc.graph;
  const byId = Object.fromEntries(g.nodes.map(n => [n.id, n]));
  let node = byId[fromNodeId];
  let entered = true; // the node we start from has already been handled
  for (let guard = 0; node && guard < 200; guard++) {
    if (!entered) {
      if (node.type === 'task') {
        const dueAt = Number(node.dueHours) > 0 ? new Date(Date.parse(io.now().replace(' ', 'T') + 'Z') + Number(node.dueHours) * 3600000).toISOString().slice(0, 19).replace('T', ' ') : null;
        io.createTask({ nodeId: node.id, name: node.name, formId: node.formId || null, assignee: node.assignee || { type: 'initiator' }, dueAt });
        io.log(`Task “${node.name}” assigned to ${io.describe(node.assignee || { type: 'initiator' })}`);
        break; // wait for a person
      }
      if (node.type === 'action') {
        for (const a of FB.logic.assignments(node.assignments)) {
          try { proc.vars[a.name] = FB.expr.evaluate(a.expr, proc.vars); } catch (e) { io.log(`Calculation error in “${node.name}”: ${e.message}`); }
        }
        io.log(`Calculated “${node.name}”`);
      }
      if (node.type === 'record') {
        const form = io.forms.get(Number(node.formId));
        if (form) {
          const data = {};
          for (const a of FB.logic.assignments(node.mapping)) data[a.name] = FB.expr.safe(a.expr, proc.vars, null);
          if (node.mode === 'update') {
            const id = Number(FB.expr.safe(node.recordId, proc.vars, null));
            if (id) { io.updateRecord(form, id, data); io.log(`Updated ${form.name} #${id}`); }
            else io.log(`“${node.name}”: no record id – nothing updated`);
          } else {
            const { values } = FB.logic.compute(form.fields, data, {}, {});
            const full = {};
            for (const f of form.fields) if (f.type !== 'heading') full[f.key] = values[f.key] ?? null;
            io.createRecord(form, full);
            proc.vars[form.slug] = full;
            io.log(`Created a record in “${form.name}”`);
          }
        }
      }
      if (node.type === 'webhook') {
        const body = {};
        for (const a of FB.logic.assignments(node.mapping)) body[a.name] = FB.expr.safe(a.expr, proc.vars, null);
        io.webhook(node.url, { event: 'flow.step', step: node.name, process: { id: proc.id, title: proc.title, flow: proc.flowName }, data: Object.keys(body).length ? body : proc.vars });
        io.log(`Sent “${node.name}” to ${safeHost(node.url)}`);
      }
      if (node.type === 'end') {
        proc.vars.outcome = node.name;
        proc.status = 'done';
        proc.finished_at = io.now();
        io.log(`Finished: ${node.name}`);
        break;
      }
    }
    entered = false;
    const edge = pickEdge(g, node, proc.vars);
    if (!edge) { proc.status = 'stuck'; io.log(`Stuck at “${node.name}”: no matching arrow.`); break; }
    if (g.edges.filter(e => e.from === node.id).length > 1) io.log(`“${node.name}” → ${edge.label || edge.condition || 'otherwise'}`);
    node = byId[edge.to];
  }
  updateTitle(proc);
}

export function pickEdge(graph, node, vars) {
  const out = graph.edges.filter(e => e.from === node.id);
  for (const e of out) if (e.condition && FB.expr.truthy(FB.expr.safe(e.condition, vars, false))) return e;
  return out.find(e => !e.condition) || null;
}

export function updateTitle(proc) {
  const s = proc.graph.nodes.find(n => n.type === 'start');
  if (!s || !s.title) return;
  if (!Object.keys(proc.vars).some(k => k !== 'initiator' && k !== 'process')) return; // no data yet
  const t = FB.expr.safe(s.title, proc.vars, null);
  if (t != null && t !== '') proc.title = String(t).slice(0, 200);
}

export function startNode(graph) { return graph.nodes.find(n => n.type === 'start'); }

/** Merge the data of a completed form into the process variables. */
export function mergeFormData(proc, form, data, linked) {
  Object.assign(proc.vars, linked || {}, data);
  proc.vars[form.slug] = data;
}

function safeHost(url) { try { return new URL(url).host; } catch { return 'webhook'; } }
