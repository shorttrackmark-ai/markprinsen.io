// Ordovia bundle: a whole process (with its forms and classes) described as plain JSON, e.g. by an AI the user pasted a prompt into.
// Nothing is trusted: the text is parsed, every name is resolved against the workspace, every formula is checked with the same
// rules as the builders, and only a plain plan comes out. The caller creates everything as drafts.
import { FB, slugify } from './lib.js';

export const FIELD_TYPES = ['text', 'textarea', 'number', 'email', 'date', 'select', 'radio', 'checkbox', 'person', 'record', 'file', 'calc', 'heading'];
export const STEP_TYPES = ['task', 'decision', 'calc', 'record', 'end'];
const LIMITS = { text: 200000, forms: 20, flows: 10, steps: 60, fields: 40 };
const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();
const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

/** The JSON object inside an AI answer: with or without a code fence, with or without chatter around it. */
export function extractJSON(text) {
  text = String(text || '');
  if (!text.trim()) throw new Error('Paste the answer of the AI first.');
  if (text.length > LIMITS.text) throw new Error('That is too much text (more than 200 KB).');
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let body = fenced ? fenced[1] : text;
  const a = body.indexOf('{'), b = body.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('I cannot find the JSON in this text. Ask the AI to answer with only the JSON code block.');
  body = body.slice(a, b + 1).replace(/[“”]/g, '"').replace(/,\s*([}\]])/g, '$1');   // smart quotes and trailing commas, the usual slips
  try { return JSON.parse(body); } catch (e) { throw new Error('The JSON is not valid (' + e.message + '). Ask the AI to return it again, complete and as valid JSON.'); }
}

/** Where a step goes: edges from `next` / `branches`; node positions in columns by distance from the start. */
function layout(nodes, edges) {
  const depth = new Map([[nodes[0].id, 0]]), q = [nodes[0].id];
  while (q.length) { const id = q.shift(); for (const e of edges.filter(x => x.from === id)) if (!depth.has(e.to)) { depth.set(e.to, depth.get(id) + 1); q.push(e.to); } }
  const col = new Map();
  for (const n of nodes) {
    const d = depth.has(n.id) ? depth.get(n.id) : 0, i = col.get(d) || 0; col.set(d, i + 1);
    n.x = 80 + d * 210; n.y = 70 + i * 110;
  }
}

/**
 * Turn the pasted bundle into a plan. ctx = { areas, tags, personFields, forms (existing), people, flows }.
 * Returns { errors, warnings, plan } – plan only when there are no errors. Placeholders (_form, _tags...) are resolved by `resolve` once ids exist.
 */
export function planBundle(b, ctx) {
  const errors = [], warnings = [];
  const err = (m) => errors.push(m), warn = (m) => warnings.push(m);
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { errors: ['The answer is not an Ordovia bundle (a JSON object).'], warnings, plan: null };
  const formsIn = Array.isArray(b.forms) ? b.forms : [], procsIn = Array.isArray(b.processes) ? b.processes : [];
  if (!formsIn.length && !procsIn.length) return { errors: ['The bundle contains no forms and no processes.'], warnings, plan: null };
  if (formsIn.length > LIMITS.forms) err('Too many forms in one go (maximum ' + LIMITS.forms + ').');
  if (procsIn.length > LIMITS.flows) err('Too many processes in one go (maximum ' + LIMITS.flows + ').');

  const existingForm = (name) => ctx.forms.find(f => norm(f.name) === norm(name) && f.status !== 'archived');
  const tagKey = (s) => { const m = String(s).split(':'); return m.length < 2 ? null : { category: m[0].trim(), value: m.slice(1).join(':').trim() }; };
  const tagsToCreate = [], tagSeen = new Set();
  const useTag = (s, where) => {
    const t = tagKey(s);
    if (!t || !t.category || !t.value) { err(where + ': “' + s + '” is not a tag; write it as “Category: Value”, e.g. “Function: Manager”.'); return null; }
    const found = ctx.tags.find(x => norm(x.category) === norm(t.category) && norm(x.value) === norm(t.value));
    const canon = found ? found.category + ': ' + found.value : t.category + ': ' + t.value;
    if (!found && !tagSeen.has(norm(canon))) { tagSeen.add(norm(canon)); tagsToCreate.push({ category: t.category, value: t.value }); }
    return canon;
  };

  // ---- area
  const areaName = str(b.area, 80);
  const area = areaName ? { name: (ctx.areas.find(a => norm(a.name) === norm(areaName)) || {}).name || areaName, id: (ctx.areas.find(a => norm(a.name) === norm(areaName)) || {}).id || null } : null;

  // ---- forms
  const forms = [], formNames = new Map();   // normalised name -> entry
  for (const f of formsIn) {
    const name = str(f && f.name, 120);
    if (!name) { err('A form has no name.'); continue; }
    if (formNames.has(norm(name))) { err('The form “' + name + '” appears twice.'); continue; }
    const ex = existingForm(name);
    const entry = { name, slug: slugify(name), description: str(f.description, 300), is_class: !!(f.class || f.is_class), fields: [], existingId: ex ? ex.id : null, isNew: !ex };
    formNames.set(norm(name), entry); forms.push(entry);
    if (ex) { warn('The form “' + name + '” already exists and is used as it is; the fields in the answer are ignored.'); entry.is_class = !!ex.is_class; continue; }
    const fields = Array.isArray(f.fields) ? f.fields : [];
    if (!fields.length) err('The form “' + name + '” has no fields.');
    if (fields.length > LIMITS.fields) err('The form “' + name + '” has too many fields (maximum ' + LIMITS.fields + ').');
    const keys = new Set();
    for (const fd of fields.slice(0, LIMITS.fields)) {
      const label = str(fd && fd.label, 120), type = str(fd && fd.type, 20), key = str(fd && fd.key, 60);
      const where = 'Form “' + name + '”, field “' + (label || key || '?') + '”';
      if (!FIELD_TYPES.includes(type)) { err(where + ': the type “' + type + '” does not exist. Use one of: ' + FIELD_TYPES.join(', ') + '.'); continue; }
      if (!FB.logic.KEY_RE.test(key)) { err(where + ': the key must be lower-case letters, digits and underscores (e.g. first_day).'); continue; }
      if (keys.has(key)) { err(where + ': the key “' + key + '” is used twice.'); continue; }
      keys.add(key);
      const o = { key, label: label || key, type };
      if (fd.required) o.required = true;
      if (['select', 'radio'].includes(type)) { o.options = (Array.isArray(fd.options) ? fd.options : []).map(x => str(x, 80)).filter(Boolean).slice(0, 40); if (!o.options.length) err(where + ': give the options.'); }
      for (const p of ['default', 'formula', 'visibleIf', 'validate', 'validateMsg', 'help', 'placeholder', 'checkLabel', 'pattern', 'patternMsg']) if (fd[p] != null && fd[p] !== '') o[p] = str(fd[p], 300);
      for (const p of ['min', 'max', 'decimals']) if (fd[p] != null && fd[p] !== '' && Number.isFinite(Number(fd[p]))) o[p] = Number(fd[p]);
      if (fd.integer) o.integer = true;
      if (fd.width === 'half') o.width = 'half';
      if (fd.format && FB.logic.FORMATS[fd.format]) o.format = fd.format;
      if (type === 'calc' && !o.formula) err(where + ': a calculation needs a formula.');
      if (type === 'person') { o._personTags = (Array.isArray(fd.person_tags) ? fd.person_tags : []).map(t => useTag(t, where)).filter(Boolean); }
      if (type === 'record') { o._recordForm = str(fd.record_form, 120); o.recordForm = 'pending'; if (fd.record_label) o.recordLabel = str(fd.record_label, 60); if (!o._recordForm) err(where + ': say which form it links to (record_form).'); }
      entry.fields.push(o);
    }
    for (const p of FB.logic.lint({ fields: entry.fields, checks: [] })) err('Form “' + name + '”: ' + p);
  }
  for (const f of forms) for (const fd of f.fields) if (fd.type === 'record' && fd._recordForm && !formNames.has(norm(fd._recordForm)) && !existingForm(fd._recordForm)) err('Form “' + f.name + '”, field “' + fd.label + '”: the linked form “' + fd._recordForm + '” does not exist (add it to the forms).');
  const usedExisting = new Set();
  const formByName = (name) => {
    const mine = formNames.get(norm(name));
    if (mine) { if (!mine.isNew) usedExisting.add(mine.name); return mine; }
    const ex = existingForm(name);
    if (!ex) return null;
    usedExisting.add(ex.name);
    return { name: ex.name, existingId: ex.id, fields: ex.fields, is_class: !!ex.is_class };
  };

  // ---- processes
  const flows = [];
  const seenFlow = new Set();
  for (const p of procsIn) {
    const pname = str(p && p.name, 120);
    if (!pname) { err('A process has no name.'); continue; }
    if (seenFlow.has(norm(pname))) { err('The process “' + pname + '” appears twice.'); continue; }
    seenFlow.add(norm(pname));
    if (ctx.flows.some(x => norm(x.name) === norm(pname))) warn('A process called “' + pname + '” already exists. The new one is created as a separate draft; archive or rename one of them.');
    const where = 'Process “' + pname + '”';
    const steps = Array.isArray(p.steps) ? p.steps : [];
    if (!steps.length) { err(where + ': it has no steps.'); continue; }
    if (steps.length > LIMITS.steps) { err(where + ': too many steps (maximum ' + LIMITS.steps + ').'); continue; }
    const ids = new Map(), nodes = [], edges = [];
    steps.forEach((s, i) => { const sid = str(s && s.id, 40) || 's' + (i + 1); if (ids.has(sid)) err(where + ': the step id “' + sid + '” is used twice.'); ids.set(sid, 'n' + (i + 2)); });
    const reqForm = p.request_form ? formByName(p.request_form) : null;
    if (p.request_form && !reqForm) err(where + ': the request form “' + p.request_form + '” does not exist.');
    const startTags = (Array.isArray(p.who_can_start) ? p.who_can_start : []).map(t => useTag(t, where + ' (who can start)')).filter(Boolean);
    let subjectName = null;
    if (p.works_on) { const sf = formByName(p.works_on); if (!sf) err(where + ': “works_on” names the class “' + p.works_on + '”, which does not exist.'); else if (!sf.is_class) err(where + ': “' + sf.name + '” is not a class (set "class": true on that form).'); else subjectName = sf.name; }
    const start = { id: 'n1', type: 'start', name: 'Start' };
    if (reqForm) start._form = reqForm.name;
    if (subjectName) start._subject = subjectName;
    if (startTags.length) start._startTags = startTags;
    if (p.title) { const e = FB.expr.check(p.title); if (e) err(where + ': the title formula: ' + e); else start.title = str(p.title, 300); }
    nodes.push(start);
    const target = (to, s, what) => { const id = ids.get(String(to)); if (!id) err(where + ', step “' + str(s.name, 60) + '”: ' + what + ' points to “' + to + '”, which is not a step.'); return id; };
    steps.forEach((s, i) => {
      const nid = ids.get(str(s && s.id, 40) || 's' + (i + 1)), type = str(s && s.type, 12), name = str(s && s.name, 120);
      const sw = where + ', step “' + (name || nid) + '”';
      if (!name) err(where + ': step ' + (i + 1) + ' has no name.');
      if (type === 'webhook') { err(sw + ': webhook steps are not created from an AI answer; add integrations by hand in the designer.'); return; }
      if (!STEP_TYPES.includes(type)) { err(sw + ': the step type “' + type + '” does not exist. Use task, decision, calc, record or end.'); return; }
      const node = { id: nid, type: type === 'calc' ? 'action' : type, name };
      if (s.instructions) node.instructions = str(s.instructions, 1000);
      if (type === 'task') {
        if (s.form) { const f = formByName(s.form); if (!f) err(sw + ': the form “' + s.form + '” does not exist.'); else node._form = f.name; }
        const w = s.who == null || s.who === 'initiator' ? { type: 'initiator' } : s.who;
        if (typeof w === 'object' && w.type === 'initiator') node.assignee = { type: 'initiator' };
        else if (w && w.type === 'tags') { node.assignee = { type: 'tags', _tags: (Array.isArray(w.tags) ? w.tags : []).map(t => useTag(t, sw)).filter(Boolean) }; if (!node.assignee._tags.length) err(sw + ': “who” needs at least one tag.'); const same = (Array.isArray(w.same_as_initiator) ? w.same_as_initiator : []).map(c => str(c, 60)).filter(Boolean); if (same.length) node.assignee.sameAs = same; }
        else if (w && w.type === 'attribute') {
          const pf = ctx.personFields.find(x => norm(x.label) === norm(w.attribute) || norm(x.key) === norm(w.attribute));
          if (!pf) err(sw + ': the person attribute “' + w.attribute + '” does not exist' + (ctx.personFields.length ? ' (known: ' + ctx.personFields.map(x => x.label).join(', ') + ')' : ' (no attributes are defined yet)') + '.');
          else if (w.value == null || w.value === '') err(sw + ': “who” needs the value of ' + pf.label + '.');
          else node.assignee = { type: 'attr', key: pf.key, label: pf.label, value: str(w.value, 80) };
        } else if (w && w.type === 'field') {
          const key = str(w.field, 60);
          const ok = forms.concat(ctx.forms.map(f => ({ fields: f.fields }))).some(f => f.fields.some(fd => fd.key === key && fd.type === 'person'));
          if (!ok) warn(sw + ': no person field “' + key + '” was found in the forms; check that an earlier form has it.');
          node.assignee = { type: 'field', field: key };
        } else if (w && w.type === 'person') {
          const pe = ctx.people.find(x => norm(x.name) === norm(w.person));
          if (!pe) err(sw + ': the person “' + w.person + '” does not exist.'); else node.assignee = { type: 'person', personId: pe.id };
        } else err(sw + ': “who” must be initiator, tags, attribute, field or person.');
        if (s.due_hours != null && Number.isFinite(Number(s.due_hours)) && Number(s.due_hours) > 0) node.dueHours = Math.min(Number(s.due_hours), 24 * 365);
        if (s.next) { const to = target(s.next, s, '“next”'); if (to) edges.push({ from: nid, to }); } else err(sw + ': it has no “next” step.');
      } else if (type === 'decision') {
        const br = Array.isArray(s.branches) ? s.branches : [];
        if (br.length < 2) err(sw + ': a decision needs at least two branches.');
        let open = 0;
        for (const x of br) {
          const to = target(x && x.to, s, 'a branch'); const e = { from: nid, to, label: str(x && x.label, 60) };
          if (x && x.when) { const er = FB.expr.check(x.when); if (er) err(sw + ', branch “' + e.label + '”: ' + er); else e.condition = str(x.when, 300); } else open++;
          if (to) edges.push(e);
        }
        if (open > 1) err(sw + ': only one branch may have no condition (“otherwise”).');
        if (br.length >= 2 && open === 0) warn(sw + ': every branch has a condition; if none is true the case gets stuck. Make the last branch the “otherwise” (no “when”).');
      } else if (type === 'calc') {
        const set = (Array.isArray(s.set) ? s.set : String(s.set || '').split('\n')).map(x => String(x).trim()).filter(Boolean);
        if (!set.length) err(sw + ': a calculation needs at least one line like “total = quantity * price”.');
        for (const line of set) { const m = line.match(/^([a-z_][a-z0-9_]*)\s*=\s*(.+)$/); if (!m) err(sw + ': “' + line + '” must look like “name = formula”.'); else { const er = FB.expr.check(m[2]); if (er) err(sw + ', “' + line + '”: ' + er); } }
        node.assignments = set.join('\n');
        if (s.next) { const to = target(s.next, s, '“next”'); if (to) edges.push({ from: nid, to }); } else err(sw + ': it has no “next” step.');
      } else if (type === 'record') {
        const f = s.form ? formByName(s.form) : null;
        if (!f) err(sw + ': the form “' + s.form + '” does not exist.'); else node._form = f.name;
        node.mode = s.mode === 'update' ? 'update' : 'create';
        const set = (Array.isArray(s.set) ? s.set : String(s.set || '').split('\n')).map(x => String(x).trim()).filter(Boolean);
        for (const line of set) { const m = line.match(/^([a-z_][a-z0-9_]*)\s*=\s*(.+)$/); if (!m) err(sw + ': “' + line + '” must look like “name = formula”.'); else { const er = FB.expr.check(m[2]); if (er) err(sw + ', “' + line + '”: ' + er); } }
        node.mapping = set.join('\n');
        if (node.mode === 'update') { const rid = s.record_id || (subjectName ? 'subject.id' : ''); if (!rid) err(sw + ': an update needs “record_id” (a formula giving the record id).'); else { const er = FB.expr.check(rid); if (er) err(sw + ': record_id: ' + er); else node.recordId = str(rid, 200); } }
        if (s.next) { const to = target(s.next, s, '“next”'); if (to) edges.push({ from: nid, to }); } else err(sw + ': it has no “next” step.');
      }
      nodes.push(node);
    });
    if (!nodes.some(n => n.type === 'end')) err(where + ': it needs at least one end step.');
    if (errors.length) continue;
    edges.unshift({ from: 'n1', to: ids.get(str(steps[0].id, 40) || 's1') });
    const reach = new Set(['n1']), q = ['n1'];
    while (q.length) { const id = q.shift(); for (const e of edges.filter(x => x.from === id)) if (!reach.has(e.to)) { reach.add(e.to); q.push(e.to); } }
    for (const n of nodes) if (!reach.has(n.id)) warn(where + ': the step “' + n.name + '” cannot be reached from the start.');
    edges.forEach((e, i) => { e.id = 'e' + (i + 1); });
    layout(nodes, edges);
    flows.push({ name: pname, description: str(p.description, 300), doc: { purpose: str(p.purpose, 400), owner: str(p.owner_role || p.owner, 80), scope: str(p.scope, 200), records: str(p.records, 200) }, graph: { nodes, edges } });
  }
  if (errors.length) return { errors, warnings, plan: null };
  return { errors, warnings, plan: { area, tags: tagsToCreate, forms: forms.filter(f => f.isNew), usedForms: [...new Set([...forms.filter(f => !f.isNew).map(f => f.name), ...usedExisting])], flows } };
}

/** Fill in the ids once everything exists: forms by name, tags by "Category: Value". Returns the final graphs and form fields. */
export function resolve(plan, formIds, tagIds) {
  const fid = (name) => formIds.get(norm(name)), tid = (s) => tagIds.get(norm(s));
  const forms = plan.forms.map(f => ({ ...f, fields: f.fields.map(fd => {
    const o = { ...fd };
    if (o._personTags) { o.personTags = o._personTags.map(tid).filter(Boolean); delete o._personTags; }
    if (o._recordForm) { o.recordForm = fid(o._recordForm); delete o._recordForm; }
    return o;
  }) }));
  const flows = plan.flows.map(fl => ({ ...fl, graph: { edges: fl.graph.edges, nodes: fl.graph.nodes.map(n => {
    const o = { ...n };
    if (o._form) { o.formId = fid(o._form); delete o._form; }
    if (o._subject) { o.subjectForm = fid(o._subject); delete o._subject; }
    if (o._startTags) { o.startTags = o._startTags.map(tid).filter(Boolean); delete o._startTags; }
    if (o.assignee && o.assignee._tags) { o.assignee = { ...o.assignee, tagIds: o.assignee._tags.map(tid).filter(Boolean) }; delete o.assignee._tags; }
    return o;
  }) } }));
  return { forms, flows };
}
