// Ordovia demo workspace: a small company with people, tags, linked forms, three processes,
// a dashboard and four months of simulated history. The real engine runs in memory and the
// result is written with a handful of bulk INSERTs (keeps D1 query counts low).
import { FB, lit, slugify, hashPassword, makeDirectory, recordLabel, formViewSQL } from './lib.js';
import { advance, startNode, mergeFormData } from './engine.js';

export const DEMO_PASSWORD = 'demo1234';

export async function seedDemo(db, admin) {
  const M = { flow_versions: [], areas: [], settings: [], persons: [], tags: [], person_tags: [], forms: [], flows: [], instances: [], tasks: [], submissions: [], events: [], dashboards: [] };
  const nextId = {}; const id = (t) => (nextId[t] = (nextId[t] || 0) + 1);
  let clock = Date.now();
  const at = () => new Date(clock).toISOString().slice(0, 19).replace('T', ' ');

  // ---- tags & people ----
  const T = {};
  const tag = (category, value) => { const tid = id('tags'); M.tags.push({ id: tid, category, value }); T[category + ':' + value] = tid; };
  ['Employee', 'Manager', 'HR', 'Finance'].forEach(v => tag('Function', v));
  ['Sales', 'Operations', 'Finance'].forEach(v => tag('Department', v));
  ['Amsterdam', 'Rotterdam'].forEach(v => tag('Location', v));

  const demoHash = await hashPassword(DEMO_PASSWORD);
  const P = {};
  const person = (key, name, email, hash, isAdmin, tags) => {
    const pid = id('persons');
    M.persons.push({ id: pid, name, email, pw_hash: hash, is_admin: isAdmin ? 1 : 0, active: 1, created_at: at() });
    tags.forEach(t => M.person_tags.push({ person_id: pid, tag_id: T[t] }));
    P[key] = pid;
  };
  person('admin', admin.name, admin.email, admin.hash, true, ['Function:HR', 'Department:Operations', 'Location:Amsterdam']);
  person('anna', 'Anna de Vries', 'anna@example.com', demoHash, false, ['Function:Manager', 'Department:Sales', 'Location:Amsterdam']);
  person('bram', 'Bram Jansen', 'bram@example.com', demoHash, false, ['Function:Employee', 'Department:Sales', 'Location:Amsterdam']);
  person('sanne', 'Sanne Bakker', 'sanne@example.com', demoHash, false, ['Function:Employee', 'Department:Sales', 'Location:Rotterdam']);
  person('carla', 'Carla Smit', 'carla@example.com', demoHash, false, ['Function:Employee', 'Department:Operations', 'Location:Rotterdam']);
  person('daan', 'Daan Visser', 'daan@example.com', demoHash, false, ['Function:Manager', 'Department:Operations', 'Location:Rotterdam']);
  person('eva', 'Eva Mulder', 'eva@example.com', demoHash, false, ['Function:Finance', 'Department:Finance', 'Location:Amsterdam']);
  const D = makeDirectory(M.persons, M.tags, M.person_tags);

  // ---- areas: how everything is grouped (a department or domain that offers processes to the rest) ----
  const A = {};
  const area = (key, name, description, owner, color) => { const aid = id('areas'); M.areas.push({ id: aid, name, description, color, owner_id: P[owner], created_at: at() }); A[key] = aid; };
  area('hr', 'People & HR', 'Leave, onboarding and everything about our people.', 'admin', '#7c3aed');
  area('fin', 'Purchasing & Finance', 'Buying, suppliers and payments.', 'eva', '#0891b2');
  area('ops', 'Operations & Quality', 'Incidents, corrective actions and day-to-day operations.', 'daan', '#ea580c');

  // ---- forms ----
  const forms = new Map();
  const form = (name, description, fields, extra = {}) => {
    const fid = id('forms');
    const f = { id: fid, name, slug: slugify(name), description, fields, checks: extra.checks || [], access: extra.access || {}, area_id: null, status: 'active', owner_id: P.admin, updated_at: at() };
    M.forms.push(f); forms.set(fid, f);
    return fid;
  };
  const supplierForm = form('Supplier', 'Master data: suppliers that purchase requests link to.', [
    { key: 'name', label: 'Company name', type: 'text', required: true },
    { key: 'country', label: 'Country', type: 'select', options: ['Netherlands', 'Belgium', 'Germany', 'Other'], required: true, width: 'half' },
    { key: 'payment_days', label: 'Payment term (days)', type: 'number', default: '30', min: 0, max: 120, width: 'half' },
    { key: 'contact', label: 'Contact e-mail', type: 'email' },
    { key: 'approved', label: 'Approved supplier', type: 'checkbox', checkLabel: 'Passed the supplier assessment' },
  ], { access: { addTags: [T['Function:Finance']] } });
  const leaveForm = form('Leave request', 'Request days off. More than 3 working days needs approval from your own manager.', [
    { key: 'type', label: 'Type of leave', type: 'radio', options: ['Vacation', 'Special leave', 'Other'], required: true },
    { key: 'start_date', label: 'First day', type: 'date', required: true, width: 'half', default: 'TODAY()' },
    { key: 'end_date', label: 'Last day', type: 'date', required: true, width: 'half', validate: 'end_date >= start_date', validateMsg: 'Last day must be on or after the first day.' },
    { key: 'days', label: 'Working days', type: 'calc', formula: 'WORKDAYS(start_date, end_date)', decimals: 0 },
    { key: 'reason', label: 'Please explain', type: 'textarea', required: true, visibleIf: 'type == "Other"' },
  ], { access: { direct: false }, checks: [{ rule: 'days <= 25', message: 'A single request can be at most 25 working days – split it up.' }] });
  const approvalForm = form('Approval', 'Generic approve / reject step, reused in every process.', [
    { key: 'decision', label: 'Decision', type: 'radio', options: ['Approve', 'Reject'], required: true },
    { key: 'comment', label: 'Why rejected?', type: 'textarea', required: true, visibleIf: 'decision == "Reject"' },
  ], { access: { direct: false } });
  const purchaseForm = form('Purchase request', 'Order something. Above € 250 your budget holder approves, above € 1,000 Finance as well.', [
    { key: 'item', label: 'What do you need?', type: 'text', required: true },
    { key: 'supplier', label: 'Supplier', type: 'record', recordForm: supplierForm, recordLabel: 'name', required: true, help: 'Only approved suppliers can be used (logic check).' },
    { key: 'category', label: 'Category', type: 'select', options: ['Hardware', 'Software', 'Office', 'Travel', 'Services'], required: true, width: 'half' },
    { key: 'needed_by', label: 'Needed by', type: 'date', width: 'half', default: 'ADDDAYS(TODAY(), 14)' },
    { key: 'h_cost', label: 'Costs', type: 'heading' },
    { key: 'quantity', label: 'Quantity', type: 'number', required: true, min: 1, default: '1', width: 'half' },
    { key: 'unit_price', label: 'Unit price (€, excl. VAT)', type: 'number', required: true, min: 0, width: 'half' },
    { key: 'total', label: 'Total excl. VAT', type: 'calc', formula: 'quantity * unit_price' },
    { key: 'vat', label: 'VAT', type: 'calc', formula: 'IF(supplier.country == "Netherlands", ROUND(total * 0.21, 2), 0)', help: 'Reverse-charged (0%) for foreign suppliers – read from the linked supplier record.' },
    { key: 'total_incl', label: 'Total incl. VAT', type: 'calc', formula: 'total + vat' },
    { key: 'budget_holder', label: 'Budget holder', type: 'person', personTags: [T['Function:Manager']], required: true, visibleIf: 'total_incl > 250', help: 'Required above € 250 – this person approves the request.' },
  ], { access: { direct: false }, checks: [
    { rule: 'supplier.approved', message: 'This supplier has not passed the supplier assessment yet.' },
    { rule: 'ISEMPTY(needed_by) or needed_by >= TODAY()', message: '“Needed by” cannot be in the past.' },
  ] });
  const orderForm = form('Order register', 'Filled automatically when a purchase is approved.', [
    { key: 'item', label: 'Item', type: 'text' },
    { key: 'supplier', label: 'Supplier', type: 'text' },
    { key: 'amount', label: 'Amount incl. VAT', type: 'number' },
    { key: 'requested_by', label: 'Requested by', type: 'text' },
    { key: 'status', label: 'Status', type: 'select', options: ['To order', 'Ordered', 'Delivered'] },
    { key: 'pay_before', label: 'Pay before', type: 'date' },
  ], { access: { viewTags: [T['Function:Finance']], direct: false } });
  const incidentForm = form('Incident report', 'Report a quality, safety or customer issue.', [
    { key: 'title', label: 'Short description', type: 'text', required: true },
    { key: 'kind', label: 'Kind', type: 'select', options: ['Quality', 'Safety', 'Customer complaint', 'IT'], required: true, width: 'half' },
    { key: 'happened_on', label: 'Date', type: 'date', required: true, default: 'TODAY()', width: 'half', validate: 'happened_on <= TODAY()', validateMsg: 'Cannot be in the future.' },
    { key: 'severity', label: 'Severity (1-5)', type: 'number', required: true, min: 1, max: 5, width: 'half' },
    { key: 'likelihood', label: 'Likelihood (1-5)', type: 'number', required: true, min: 1, max: 5, width: 'half' },
    { key: 'risk', label: 'Risk score', type: 'calc', formula: 'severity * likelihood', decimals: 0 },
    { key: 'risk_level', label: 'Risk level', type: 'calc', formula: 'IF(risk >= 15, "High", IF(risk >= 6, "Medium", "Low"))' },
    { key: 'details', label: 'What happened?', type: 'textarea', required: true },
  ], { access: { direct: false } });
  const actionForm = form('Corrective action', 'Root cause and action for an incident.', [
    { key: 'root_cause', label: 'Root cause', type: 'textarea', required: true },
    { key: 'action', label: 'Corrective action', type: 'textarea', required: true },
    { key: 'owner', label: 'Action owner', type: 'person', required: true },
    { key: 'deadline', label: 'Deadline', type: 'date', required: true, default: 'ADDDAYS(TODAY(), 30)', validate: 'deadline >= TODAY()', validateMsg: 'Deadline must be in the future.' },
  ], { access: { direct: false } });

  // ---- flows (with handbook documentation) ----
  const flows = new Map();
  const flow = (name, description, doc, graph) => { const fid = id('flows'); const f = { id: fid, name, description, doc, graph, version: 1, area_id: null, status: 'active', owner_id: null, review_months: 12, reviewed_at: at(), updated_at: at() }; M.flows.push(f); flows.set(fid, f); return fid; };
  const mgrSameDept = { type: 'tags', tagIds: [T['Function:Manager']], sameAs: ['Department'] };

  const leaveFlow = flow('Leave request', 'Ask for days off; long leave goes to your own manager.',
    { purpose: 'Make sure leave is registered and that longer absences are agreed with the manager in time.', owner: 'HR', scope: 'All employees', records: 'Leave request records are kept for 2 years.' }, {
      nodes: [
        { id: 'n1', type: 'start', name: 'Start', x: 80, y: 200, title: '"Leave " & initiator.name & IF(days, " – " & days & " days", "")' },
        { id: 'n2', type: 'task', name: 'Fill in leave request', x: 270, y: 200, formId: leaveForm, assignee: { type: 'initiator' }, instructions: 'Check your remaining leave balance first. Request at least 2 weeks in advance for vacations.' },
        { id: 'n3', type: 'decision', name: 'More than 3 days?', x: 470, y: 200 },
        { id: 'n4', type: 'task', name: 'Manager approval', x: 670, y: 110, formId: approvalForm, assignee: mgrSameDept, dueHours: 48, instructions: 'Check team planning and peak periods. When rejecting, propose an alternative period.' },
        { id: 'n5', type: 'action', name: 'Auto-approve', x: 670, y: 300, assignments: 'decision = "Approve"\nauto_approved = true' },
        { id: 'n6', type: 'decision', name: 'Approved?', x: 870, y: 200 },
        { id: 'n7', type: 'end', name: 'Approved', x: 1060, y: 130 },
        { id: 'n8', type: 'end', name: 'Rejected', x: 1060, y: 280 },
      ],
      edges: [
        { id: 'e1', from: 'n1', to: 'n2' }, { id: 'e2', from: 'n2', to: 'n3' },
        { id: 'e3', from: 'n3', to: 'n4', label: 'Yes', condition: 'days > 3' }, { id: 'e4', from: 'n3', to: 'n5', label: 'No' },
        { id: 'e5', from: 'n4', to: 'n6' }, { id: 'e6', from: 'n5', to: 'n6' },
        { id: 'e7', from: 'n6', to: 'n7', label: 'Yes', condition: 'decision == "Approve"' }, { id: 'e8', from: 'n6', to: 'n8', label: 'No' },
      ],
    });
  const purchaseFlow = flow('Purchase request', 'Order goods or services; budget holder and Finance approve depending on the amount.',
    { purpose: 'Control spending and make sure every purchase is approved by the right person and registered for Finance.', owner: 'Finance', scope: 'All purchases from external suppliers', records: 'Approved purchases are written to the Order register automatically.' }, {
      nodes: [
        { id: 'n1', type: 'start', name: 'Start', x: 80, y: 200, title: '"Purchase: " & item & IF(total_incl, " (€ " & ROUND(total_incl, 0) & ")", "")' },
        { id: 'n2', type: 'task', name: 'Describe purchase', x: 260, y: 200, formId: purchaseForm, assignee: { type: 'initiator' }, instructions: 'Choose an approved supplier. Ask for a quote first for amounts above € 1,000.' },
        { id: 'n3', type: 'decision', name: 'Above € 250?', x: 450, y: 200 },
        { id: 'n4', type: 'task', name: 'Budget holder approval', x: 640, y: 110, formId: approvalForm, assignee: { type: 'field', field: 'budget_holder' }, dueHours: 48, instructions: 'Check the budget and whether the purchase is really needed.' },
        { id: 'n5', type: 'decision', name: 'Approved & above € 1,000?', x: 840, y: 110 },
        { id: 'n6', type: 'task', name: 'Finance approval', x: 1040, y: 40, formId: approvalForm, assignee: { type: 'tags', tagIds: [T['Function:Finance']] }, dueHours: 72, instructions: 'Check against the annual budget and payment terms.' },
        { id: 'n7', type: 'decision', name: 'Approved?', x: 1040, y: 200 },
        { id: 'n8', type: 'record', name: 'Add to order register', x: 1240, y: 130, formId: orderForm, mode: 'create',
          mapping: 'item = item\nsupplier = supplier_label\namount = total_incl\nrequested_by = initiator.name\nstatus = "To order"\npay_before = ADDDAYS(TODAY(), supplier.payment_days)' },
        { id: 'n9', type: 'end', name: 'Ordered', x: 1430, y: 130 },
        { id: 'n10', type: 'end', name: 'Rejected', x: 1240, y: 280 },
        { id: 'n11', type: 'action', name: 'Auto-approve small purchase', x: 640, y: 300, assignments: 'decision = "Approve"' },
      ],
      edges: [
        { id: 'e1', from: 'n1', to: 'n2' }, { id: 'e2', from: 'n2', to: 'n3' },
        { id: 'e3', from: 'n3', to: 'n4', label: 'Yes', condition: 'total_incl > 250' }, { id: 'e4', from: 'n3', to: 'n11', label: 'No' },
        { id: 'e5', from: 'n4', to: 'n5' },
        { id: 'e6', from: 'n5', to: 'n6', label: 'Yes', condition: 'decision == "Approve" and total_incl > 1000' }, { id: 'e7', from: 'n5', to: 'n7', label: 'No' },
        { id: 'e8', from: 'n6', to: 'n7' }, { id: 'e9', from: 'n11', to: 'n7' },
        { id: 'e10', from: 'n7', to: 'n8', label: 'Yes', condition: 'decision == "Approve"' }, { id: 'e11', from: 'n7', to: 'n10', label: 'No' },
        { id: 'e12', from: 'n8', to: 'n9' },
      ],
    });
  const incidentFlow = flow('Incident & corrective action', 'Report an incident; medium and high risks get a root-cause analysis and corrective action.',
    { purpose: 'Learn from incidents and prevent recurrence (ISO 9001 §10.2 nonconformity and corrective action).', owner: 'Operations', scope: 'Quality, safety, customer and IT incidents', records: 'Incidents and actions are kept for 5 years.' }, {
      nodes: [
        { id: 'n1', type: 'start', name: 'Start', x: 80, y: 180, title: '"Incident: " & title & IF(risk_level, " (" & risk_level & ")", "")' },
        { id: 'n2', type: 'task', name: 'Report incident', x: 260, y: 180, formId: incidentForm, assignee: { type: 'initiator' }, instructions: 'Describe facts, not blame. Take photos if relevant and add them later.' },
        { id: 'n3', type: 'decision', name: 'Risk medium or high?', x: 460, y: 180 },
        { id: 'n4', type: 'task', name: 'Root cause & action', x: 660, y: 100, formId: actionForm, assignee: mgrSameDept, dueHours: 120, instructions: 'Use the 5×why method. Assign one owner and a realistic deadline.' },
        { id: 'n5', type: 'end', name: 'Action planned', x: 860, y: 100 },
        { id: 'n6', type: 'end', name: 'Registered', x: 660, y: 280 },
      ],
      edges: [
        { id: 'e1', from: 'n1', to: 'n2' }, { id: 'e2', from: 'n2', to: 'n3' },
        { id: 'e3', from: 'n3', to: 'n4', label: 'Yes', condition: 'risk >= 6' }, { id: 'e4', from: 'n3', to: 'n6', label: 'No' },
        { id: 'e5', from: 'n4', to: 'n5' },
      ],
    });

  // ---- in-memory engine io ----
  function memIO(proc) {
    return {
      now: at, forms, describe: (r) => D.describe(r),
      log: (message, personId) => M.events.push({ id: id('events'), instance_id: proc.id, person_id: personId ?? null, message, created_at: at() }),
      createTask: (t) => M.tasks.push({ id: id('tasks'), instance_id: proc.id, node_id: t.nodeId, name: t.name, form_id: t.formId, assignee: JSON.stringify(t.assignee), status: 'open', due_at: t.dueAt, created_at: at() }),
      createRecord: (f, data) => M.submissions.push({ id: id('submissions'), form_id: f.id, person_id: null, instance_id: proc.id, data, created_at: at() }),
      updateRecord: (f, rid, patch) => { const s = M.submissions.find(x => x.id === rid && x.form_id === f.id); if (s) { Object.assign(s.data, patch); s.updated_at = at(); } },
      webhook: () => {},
    };
  }
  const procs = new Map();
  function start(flowId, pid) {
    const f = flows.get(flowId);
    const iid = id('instances');
    const proc = { id: iid, flowName: f.name, graph: f.graph, vars: { initiator: D.profile(pid), process: f.name }, title: `${f.name} #${iid}`, status: 'running', started_by: pid, finished_at: null, created_at: at(), flow_id: flowId };
    procs.set(iid, proc);
    const io = memIO(proc);
    io.log(`Started by ${D.persons.get(pid).name}`, pid);
    advance(proc, startNode(f.graph).id, io);
    return iid;
  }
  function complete(iid, input, pid) {
    const task = M.tasks.filter(t => t.instance_id === iid && t.status === 'open').pop();
    if (!task) return false;
    const proc = procs.get(iid);
    const f = forms.get(task.form_id);
    const lookup = (fd, v) => {
      if (fd.type === 'person') { const p = D.persons.get(v); return p ? { label: p.name, data: D.profile(v) } : null; }
      const s = M.submissions.find(x => x.id === v && x.form_id === Number(fd.recordForm));
      return s ? { label: recordLabel(forms.get(s.form_id), s.id, s.data, fd.recordLabel), data: s.data } : null;
    };
    const res = FB.logic.finalize(f, input, proc.vars, lookup);
    if (!res.ok) throw new Error(`Demo data invalid for ${f.name}: ${JSON.stringify(res.errors)} ${res.formErrors}`);
    const sid = id('submissions');
    M.submissions.push({ id: sid, form_id: f.id, person_id: pid, instance_id: iid, task_id: task.id, data: res.data, created_at: at() });
    Object.assign(task, { status: 'done', completed_by: pid, completed_at: at(), submission_id: sid });
    mergeFormData(proc, f, res.data, res.linked);
    const io = memIO(proc);
    io.log(`Task “${task.name}” completed by ${D.persons.get(pid).name}`, pid);
    advance(proc, task.node_id, io);
    return true;
  }

  // ---- four months of history ----
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const DAY = 86400000, HOUR = 3600000, NOW = Date.now();
  const iso = (t) => new Date(t).toISOString().slice(0, 10);

  const suppliers = [['Office Depot NL', 'Netherlands', 30, true], ['Coolblue Business', 'Netherlands', 14, true], ['Dell Technologies', 'Germany', 45, true], ['Brussels Consulting', 'Belgium', 30, true], ['Drukkerij de Vries', 'Netherlands', 30, true], ['Cheap Gadgets Ltd', 'Other', 60, false]]
    .map(([name, country, days, approved], i) => {
      clock = NOW - (150 - i) * DAY;
      const sid = id('submissions');
      M.submissions.push({ id: sid, form_id: supplierForm, person_id: P.eva, data: { name, country, payment_days: days, contact: 'orders@' + slugify(name).replace(/_/g, '') + '.example', approved }, created_at: at() });
      return { id: sid, name, country, approved };
    }).filter(s => s.approved);

  const staff = [P.bram, P.sanne, P.carla, P.anna, P.daan, P.eva];
  const managerOf = { [P.bram]: P.anna, [P.sanne]: P.anna, [P.anna]: P.anna, [P.carla]: P.daan, [P.daan]: P.daan, [P.eva]: P.daan, [P.admin]: P.daan };
  const items = [['Laptop', 'Hardware', 1150], ['Monitor 27"', 'Hardware', 289], ['Office chairs', 'Office', 245], ['CRM licence (year)', 'Software', 840], ['Train tickets', 'Travel', 95], ['Printing brochures', 'Services', 620], ['Consultancy day', 'Services', 1100], ['Headsets', 'Hardware', 79]];
  const incidents = [['Wrong labels on shipment', 'Quality', 3, 3], ['Forklift near-miss in warehouse', 'Safety', 5, 2], ['Customer received damaged goods', 'Customer complaint', 3, 4], ['E-mail outage', 'IT', 2, 2], ['Late delivery to key account', 'Customer complaint', 2, 4], ['Slippery floor at entrance', 'Safety', 4, 4]];

  const N = 44;
  for (let k = 0; k < N; k++) {
    const recent = k >= N - 7;
    const t0 = recent ? NOW - Math.floor(rnd() * 90 + 2) * HOUR : NOW - Math.floor(rnd() * 120 + 6) * DAY - Math.floor(rnd() * 8) * HOUR;
    const who = pick(staff);
    clock = t0;
    const r = rnd();
    if (r < 0.45) {
      const s = new Date(t0 + Math.floor(rnd() * 30 + 15) * DAY), e = new Date(s.getTime() + pick([0, 1, 2, 4, 4, 7, 9, 11]) * DAY);
      const type = pick(['Vacation', 'Vacation', 'Vacation', 'Special leave', 'Other']);
      const iid = start(leaveFlow, who);
      clock += 10 * 60000;
      complete(iid, { type, start_date: iso(s), end_date: iso(e), reason: type === 'Other' ? 'Moving house' : null }, who);
      if (!recent) { clock += Math.floor(rnd() * 40 + 2) * HOUR; const ok = rnd() < 0.8; complete(iid, { decision: ok ? 'Approve' : 'Reject', comment: ok ? null : 'Too busy in that period – please pick another week' }, managerOf[who]); }
    } else if (r < 0.85) {
      const [item, category, price] = pick(items), sup = pick(suppliers), quantity = pick([1, 1, 2, 3, 5]);
      const iid = start(purchaseFlow, who);
      clock += 15 * 60000;
      const bh = managerOf[who];
      // needed_by must not be in the past *at the time of the request* – evaluate the check with the simulated date
      complete(iid, { item, supplier: sup.id, category, needed_by: iso(Math.max(t0, NOW) + 14 * DAY), quantity, unit_price: price, budget_holder: bh }, who);
      if (!recent) {
        clock += Math.floor(rnd() * 30 + 3) * HOUR;
        const ok = rnd() < 0.85;
        complete(iid, { decision: ok ? 'Approve' : 'Reject', comment: ok ? null : 'Not in this quarter’s budget' }, bh);
        clock += Math.floor(rnd() * 50 + 20) * HOUR;
        complete(iid, { decision: rnd() < 0.85 ? 'Approve' : 'Reject', comment: 'Use the framework contract instead' }, P.eva);
      }
    } else {
      const [title, kind, sev, lik] = pick(incidents);
      const iid = start(incidentFlow, who);
      clock += 20 * 60000;
      complete(iid, { title, kind, happened_on: iso(t0), severity: sev, likelihood: lik, details: 'See description. Reported during daily stand-up.' }, who);
      if (!recent) { clock += Math.floor(rnd() * 72 + 4) * HOUR; complete(iid, { root_cause: 'Work instruction unclear', action: 'Update work instruction and brief the team', owner: managerOf[who], deadline: iso(Math.max(clock, NOW) + 30 * DAY) }, managerOf[who]); }
    }
  }
  // Order register statuses: older orders are delivered
  for (const s of M.submissions.filter(x => x.form_id === orderForm)) if (Date.parse(s.created_at.replace(' ', 'T') + 'Z') < NOW - 20 * DAY) s.data.status = 'Delivered';

  clock = NOW;
  for (const proc of procs.values()) M.instances.push({ id: proc.id, flow_id: proc.flow_id, flow_version: 1, graph: JSON.stringify(proc.graph), title: proc.title, status: proc.status, vars: JSON.stringify(proc.vars), started_by: proc.started_by, created_at: proc.created_at, finished_at: proc.finished_at });

  // ---- dashboards ----
  M.dashboards.push({ id: id('dashboards'), name: 'Operations overview', access: '{}', updated_at: at(), widgets: JSON.stringify([
    { id: 'w1', title: 'Open tasks', type: 'kpi', w: 1, src: 'v_tasks', agg: 'count', where: "status = 'open'", caption: 'waiting for someone' },
    { id: 'w2', title: 'Overdue tasks', type: 'kpi', w: 1, src: 'v_tasks', agg: 'count', where: 'overdue = 1', caption: 'past their due date' },
    { id: 'w3', title: 'Purchase volume', type: 'kpi', w: 1, src: 'form_purchase_request', agg: 'sum', field: 'total_incl', prefix: '€ ', decimals: 0, caption: 'incl. VAT, all requests' },
    { id: 'w4', title: 'Purchases per month (€)', type: 'line', w: 2, src: 'form_purchase_request', agg: 'sum', field: 'total_incl', groupBy: 'created_at', groupFn: 'month', prefix: '€ ', decimals: 0 },
    { id: 'w5', title: 'Process outcomes', type: 'pie', w: 1, mode: 'sql', sql: "SELECT coalesce(outcome, 'In progress') AS outcome, count(*) AS n\nFROM v_instances GROUP BY 1 ORDER BY 2 DESC" },
    { id: 'w6', title: 'Incidents by risk level', type: 'hbar', w: 1, src: 'form_incident_report', agg: 'count', groupBy: 'risk_level' },
    { id: 'w7', title: 'Spend by supplier (€)', type: 'bar', w: 2, src: 'form_purchase_request', agg: 'sum', field: 'total_incl', groupBy: 'supplier_label', prefix: '€ ', decimals: 0 },
    { id: 'w8', title: 'Leave days by department', type: 'hbar', w: 1, mode: 'sql', sql: "SELECT d.value AS department, sum(l.days) AS days\nFROM form_leave_request l\nJOIN v_people d ON d.person_id = l.person_id AND d.category = 'Department'\nGROUP BY 1 ORDER BY 2 DESC", suffix: ' d', decimals: 0 },
    { id: 'w9', title: 'Average approval time (hours)', type: 'hbar', w: 1, mode: 'sql', sql: "SELECT task, round(avg(hours_open), 1) AS hours\nFROM v_tasks WHERE status = 'done' AND task LIKE '%approval%'\nGROUP BY 1 ORDER BY 2 DESC", suffix: ' h' },
    { id: 'w10', title: 'Order register', type: 'table', w: 2, mode: 'sql', sql: 'SELECT id AS "#", substr(created_at, 1, 10) AS date, item, supplier, amount AS "€ incl. VAT", status, pay_before\nFROM form_order_register ORDER BY id DESC LIMIT 8' },
  ]) });
  M.settings.push({ key: 'demo', value: '1' });

  // ---- who owns what, and in which area ----
  const FORM_AREA = { 'Supplier': 'fin', 'Leave request': 'hr', 'Approval': 'fin', 'Purchase request': 'fin', 'Order register': 'fin', 'Incident report': 'ops', 'Corrective action': 'ops' };
  const FLOW_AREA = { 'Leave request': ['hr', 'admin'], 'Purchase request': ['fin', 'eva'], 'Incident & corrective action': ['ops', 'daan'] };
  for (const f of M.forms) f.area_id = A[FORM_AREA[f.name]] || null;
  for (const f of M.flows) { const m = FLOW_AREA[f.name]; if (m) { f.area_id = A[m[0]]; f.owner_id = P[m[1]]; } }
  for (const f of M.flows) M.flow_versions.push({ id: id('flow_versions'), flow_id: f.id, version: 1, name: f.name, graph: f.graph, doc: f.doc, saved_at: at(), saved_by: P.admin });
  for (const d of M.dashboards) { d.area_id = A.ops; d.status = 'active'; d.owner_id = P.daan; }

  // ---- write everything ----
  const enc = (v) => (v && typeof v === 'object' ? JSON.stringify(v) : v);
  const COLS = {
    settings: ['key', 'value'], persons: ['id', 'name', 'email', 'pw_hash', 'is_admin', 'active', 'created_at'],
    tags: ['id', 'category', 'value'], person_tags: ['person_id', 'tag_id'],
    areas: ['id', 'name', 'description', 'color', 'owner_id', 'created_at'],
    forms: ['id', 'name', 'slug', 'description', 'fields', 'checks', 'access', 'area_id', 'status', 'owner_id', 'updated_at'],
    flows: ['id', 'name', 'description', 'graph', 'doc', 'version', 'area_id', 'status', 'owner_id', 'review_months', 'reviewed_at', 'updated_at'],
    instances: ['id', 'flow_id', 'flow_version', 'graph', 'title', 'status', 'vars', 'started_by', 'created_at', 'finished_at'],
    tasks: ['id', 'instance_id', 'node_id', 'name', 'form_id', 'assignee', 'status', 'due_at', 'completed_by', 'submission_id', 'created_at', 'completed_at'],
    submissions: ['id', 'form_id', 'person_id', 'instance_id', 'task_id', 'data', 'created_at', 'updated_at'],
    events: ['id', 'instance_id', 'person_id', 'message', 'created_at'],
    flow_versions: ['id', 'flow_id', 'version', 'name', 'graph', 'doc', 'saved_at', 'saved_by'],
    dashboards: ['id', 'name', 'widgets', 'access', 'area_id', 'status', 'owner_id', 'updated_at'],
  };
  const stmts = [];
  for (const [table, cols] of Object.entries(COLS)) {
    // D1 limits one statement to 100 KB: group rows into chunks of at most ~80 KB
    const head = `INSERT INTO ${table} (${cols.join(', ')}) VALUES `;
    let chunk = [], size = 0;
    const flush = () => { if (chunk.length) stmts.push(head + chunk.join(',\n')); chunk = []; size = 0; };
    for (const r of M[table]) {
      const row = '(' + cols.map(cn => lit(enc(r[cn]))).join(', ') + ')';
      if (size + row.length > 80000) flush();
      chunk.push(row); size += row.length + 2;
    }
    flush();
  }
  for (const f of M.forms) stmts.push(...formViewSQL(f));
  await db.batch(stmts.map(s => db.prepare(s)));
  return P.admin;
}

