// Ordovia templates: ready-made processes (with their forms) a company can add as drafts and then adapt.
// Each one is an ordinary bundle (the same format "Describe with AI" produces), so it passes through the same checks and creation path.
// Tags such as "Role: Safety officer" are created when missing; the administrator then gives them to people.

const approval = { name: 'Approval decision', description: 'Approve or reject', fields: [
  { key: 'decision', label: 'Decision', type: 'radio', options: ['Approve', 'Reject'], required: true },
  { key: 'comment', label: 'Why rejected?', type: 'textarea', required: true, visibleIf: 'decision == "Reject"' }] };
const taskDone = (name, description) => ({ name, description, fields: [
  { key: 'done', label: 'Done', type: 'checkbox', checkLabel: 'This has been completed', required: true },
  { key: 'remarks', label: 'Remarks', type: 'textarea' }] });

export const PACKS = ['Health & safety', 'People', 'Purchasing & finance', 'Quality & equipment', 'IT'];

export const TEMPLATES = [
  // ------------------------------------------------------------------ health & safety
  { id: 'incident', pack: 'Health & safety', name: 'Incident report & corrective action', summary: 'Anyone reports an incident or near miss; risk is scored; medium and high risks get a root-cause analysis and a corrective action, with a check afterwards.', area: 'Health & Safety',
    bundle: { forms: [
      { name: 'Incident report', description: 'Report an accident, near miss or unsafe situation.', fields: [
        { key: 'title', label: 'Short description', type: 'text', required: true },
        { key: 'kind', label: 'Kind', type: 'select', options: ['Injury', 'Near miss', 'Property damage', 'Environmental', 'Other'], required: true, width: 'half' },
        { key: 'happened_on', label: 'Date', type: 'date', required: true, default: 'TODAY()', validate: 'happened_on <= TODAY()', validateMsg: 'The date cannot be in the future.', width: 'half' },
        { key: 'location', label: 'Where did it happen?', type: 'text', required: true },
        { key: 'injured', label: 'Injury', type: 'checkbox', checkLabel: 'Someone was injured' },
        { key: 'severity', label: 'Severity (1 = minor, 5 = fatal)', type: 'number', min: 1, max: 5, required: true, width: 'half' },
        { key: 'likelihood', label: 'Likelihood it happens again (1-5)', type: 'number', min: 1, max: 5, required: true, width: 'half' },
        { key: 'risk', label: 'Risk score', type: 'calc', formula: 'severity * likelihood', decimals: 0 },
        { key: 'risk_level', label: 'Risk level', type: 'calc', formula: 'IF(risk >= 15, "High", IF(risk >= 6, "Medium", "Low"))' },
        { key: 'details', label: 'What happened?', type: 'textarea', required: true }] },
      { name: 'Corrective action', description: 'Root cause and what will be done about it.', fields: [
        { key: 'root_cause', label: 'Root cause (ask "why" five times)', type: 'textarea', required: true },
        { key: 'action', label: 'Corrective action', type: 'textarea', required: true },
        { key: 'owner', label: 'Action owner', type: 'person', required: true },
        { key: 'deadline', label: 'Deadline', type: 'date', required: true, default: 'ADDDAYS(TODAY(), 30)', validate: 'deadline >= TODAY()', validateMsg: 'The deadline must be in the future.' }] },
      { name: 'Effect check', description: 'Did the action work?', fields: [
        { key: 'effective', label: 'Is the problem solved?', type: 'radio', options: ['Yes', 'No'], required: true },
        { key: 'effect_remarks', label: 'Remarks', type: 'textarea', required: true, visibleIf: 'effective == "No"' }] }],
      processes: [{ name: 'Incident report & corrective action', description: 'Report an incident; medium and high risks get a corrective action.', purpose: 'Learn from incidents and prevent them from happening again.', owner_role: 'Safety officer', scope: 'All employees and contractors', records: 'Kept for at least 5 years',
        request_form: 'Incident report', title: '"Incident: " & title & " (" & risk_level & ")"',
        steps: [
          { id: 'risk', type: 'decision', name: 'Medium or high risk?', branches: [{ label: 'Yes', when: 'risk >= 6', to: 'analyse' }, { label: 'No', to: 'filed' }] },
          { id: 'analyse', type: 'task', name: 'Analyse and plan action', form: 'Corrective action', who: { type: 'tags', tags: ['Role: Safety officer'] }, due_hours: 120, instructions: 'Make the situation safe first. Find the root cause, assign one owner and a realistic deadline.', next: 'check' },
          { id: 'check', type: 'task', name: 'Check the effect', form: 'Effect check', who: { type: 'tags', tags: ['Role: Safety officer'] }, due_hours: 720, instructions: 'Look again after the action was done. Is the risk really gone?', next: 'closed' },
          { id: 'closed', type: 'end', name: 'Closed' }, { id: 'filed', type: 'end', name: 'Registered' }] }] } },

  { id: 'inspection', pack: 'Health & safety', name: 'Safety inspection', summary: 'A regular walk-around checklist. Anything not OK becomes a task for the safety officer.', area: 'Health & Safety',
    bundle: { forms: [
      { name: 'Safety inspection', description: 'Tick what is in order.', fields: [
        { key: 'area_inspected', label: 'Area or department inspected', type: 'text', required: true },
        { key: 'inspected_on', label: 'Date', type: 'date', required: true, default: 'TODAY()', width: 'half' },
        { key: 'h_list', label: 'Checklist', type: 'heading' },
        { key: 'walkways', label: 'Walkways and floors', type: 'checkbox', checkLabel: 'Clear and not slippery' },
        { key: 'exits', label: 'Emergency exits', type: 'checkbox', checkLabel: 'Free and marked' },
        { key: 'fire', label: 'Fire extinguishers', type: 'checkbox', checkLabel: 'Present and checked' },
        { key: 'firstaid', label: 'First aid', type: 'checkbox', checkLabel: 'Kit complete, contacts visible' },
        { key: 'ppe', label: 'Protective equipment', type: 'checkbox', checkLabel: 'Available and in good condition' },
        { key: 'guards', label: 'Machine guards', type: 'checkbox', checkLabel: 'In place and working' },
        { key: 'cables', label: 'Electrical cables and sockets', type: 'checkbox', checkLabel: 'Undamaged' },
        { key: 'chemicals', label: 'Chemicals', type: 'checkbox', checkLabel: 'Stored correctly, labelled' },
        { key: 'failed', label: 'Items not OK', type: 'calc', formula: 'IF(walkways, 0, 1) + IF(exits, 0, 1) + IF(fire, 0, 1) + IF(firstaid, 0, 1) + IF(ppe, 0, 1) + IF(guards, 0, 1) + IF(cables, 0, 1) + IF(chemicals, 0, 1)', decimals: 0 },
        { key: 'findings', label: 'What needs to be fixed?', type: 'textarea', required: true, visibleIf: 'failed > 0' }] },
      { name: 'Inspection follow-up', fields: [
        { key: 'fixed_on', label: 'Fixed on', type: 'date', required: true, default: 'TODAY()' },
        { key: 'what_done', label: 'What was done', type: 'textarea', required: true }] }],
      processes: [{ name: 'Safety inspection', description: 'Walk-around checklist with follow-up.', purpose: 'Find and fix unsafe situations before they cause harm.', owner_role: 'Safety officer', scope: 'All locations', records: 'Kept for 3 years',
        request_form: 'Safety inspection', title: '"Inspection " & area_inspected & " (" & failed & " not OK)"',
        steps: [
          { id: 'any', type: 'decision', name: 'Anything not OK?', branches: [{ label: 'Yes', when: 'failed > 0', to: 'fix' }, { label: 'No', to: 'clear' }] },
          { id: 'fix', type: 'task', name: 'Fix the findings', form: 'Inspection follow-up', who: { type: 'tags', tags: ['Role: Safety officer'] }, due_hours: 168, instructions: 'Fix or arrange the repair of every finding, then describe what was done.', next: 'resolved' },
          { id: 'resolved', type: 'end', name: 'Findings resolved' }, { id: 'clear', type: 'end', name: 'All clear' }] }] } },

  { id: 'risk', pack: 'Health & safety', name: 'Risk assessment', summary: 'Describe a hazard, score the risk, record the measures. High risks need management approval.', area: 'Health & Safety',
    bundle: { forms: [
      { name: 'Risk assessment', description: 'Hazard, risk and control measures.', fields: [
        { key: 'activity', label: 'Activity or workplace', type: 'text', required: true },
        { key: 'hazard', label: 'Hazard (what can cause harm?)', type: 'textarea', required: true },
        { key: 'exposed', label: 'Who can be harmed?', type: 'select', options: ['Employees', 'Contractors', 'Visitors', 'The public'], required: true },
        { key: 'severity', label: 'Severity (1-5)', type: 'number', min: 1, max: 5, required: true, width: 'half' },
        { key: 'likelihood', label: 'Likelihood (1-5)', type: 'number', min: 1, max: 5, required: true, width: 'half' },
        { key: 'risk', label: 'Risk score', type: 'calc', formula: 'severity * likelihood', decimals: 0 },
        { key: 'risk_level', label: 'Risk level', type: 'calc', formula: 'IF(risk >= 15, "High", IF(risk >= 6, "Medium", "Low"))' },
        { key: 'measures', label: 'Control measures', type: 'textarea', required: true, help: 'First remove the hazard; then reduce it; protective equipment last.' }] },
      approval],
      processes: [{ name: 'Risk assessment', description: 'Assess a hazard; high risks are approved by a manager.', purpose: 'Know the risks and control them (risk inventory).', owner_role: 'Safety officer', scope: 'All activities and workplaces', records: 'Reviewed every year',
        request_form: 'Risk assessment', title: '"Risk: " & activity & " (" & risk_level & ")"',
        steps: [
          { id: 'high', type: 'decision', name: 'High risk?', branches: [{ label: 'Yes', when: 'risk >= 15', to: 'mgr' }, { label: 'No', to: 'review' }] },
          { id: 'mgr', type: 'task', name: 'Management approval', form: 'Approval decision', who: { type: 'tags', tags: ['Function: Manager'] }, due_hours: 72, instructions: 'Check that the measures are enough. Reject if work should not start yet.', next: 'verdict' },
          { id: 'verdict', type: 'decision', name: 'Approved?', branches: [{ label: 'Yes', when: 'decision == "Approve"', to: 'ok' }, { label: 'No', to: 'rework' }] },
          { id: 'review', type: 'task', name: 'Safety officer review', form: 'Approval decision', who: { type: 'tags', tags: ['Role: Safety officer'] }, due_hours: 120, next: 'ok2' },
          { id: 'ok2', type: 'decision', name: 'Accepted?', branches: [{ label: 'Yes', when: 'decision == "Approve"', to: 'ok' }, { label: 'No', to: 'rework' }] },
          { id: 'ok', type: 'end', name: 'Accepted' }, { id: 'rework', type: 'end', name: 'Needs rework' }] }] } },

  { id: 'toolbox', pack: 'Health & safety', name: 'Safety instruction (toolbox talk)', summary: 'Record who received which safety instruction, with a confirmation by the manager.', area: 'Health & Safety',
    bundle: { forms: [{ name: 'Safety instruction record', fields: [
      { key: 'topic', label: 'Topic', type: 'text', required: true },
      { key: 'held_on', label: 'Date', type: 'date', required: true, default: 'TODAY()', width: 'half' },
      { key: 'duration', label: 'Duration (minutes)', type: 'number', min: 1, width: 'half' },
      { key: 'attendees', label: 'Names of those present', type: 'textarea', required: true },
      { key: 'notes', label: 'Notes, questions raised', type: 'textarea' }] }, approval],
      processes: [{ name: 'Safety instruction (toolbox talk)', description: 'Register a toolbox talk.', purpose: 'Prove that employees were instructed.', owner_role: 'Safety officer', scope: 'All teams', records: 'Kept for 5 years',
        request_form: 'Safety instruction record', title: '"Instruction: " & topic',
        steps: [
          { id: 'confirm', type: 'task', name: 'Manager confirms', form: 'Approval decision', who: { type: 'tags', tags: ['Function: Manager'] }, due_hours: 72, next: 'done' },
          { id: 'done', type: 'end', name: 'Recorded' }] }] } },

  // ------------------------------------------------------------------ people
  { id: 'leave', pack: 'People', name: 'Leave request', summary: 'Up to 3 working days is registered; longer leave goes to the employee\'s own manager.', area: 'People & HR',
    bundle: { forms: [{ name: 'Leave request', fields: [
      { key: 'start_date', label: 'First day', type: 'date', required: true, default: 'TODAY()', width: 'half' },
      { key: 'end_date', label: 'Last day', type: 'date', required: true, width: 'half', validate: 'end_date >= start_date', validateMsg: 'The last day must be on or after the first day.' },
      { key: 'days', label: 'Working days', type: 'calc', formula: 'WORKDAYS(start_date, end_date)', decimals: 0 },
      { key: 'reason', label: 'Remarks', type: 'textarea' }] }, approval],
      processes: [{ name: 'Leave request', description: 'Ask for days off.', purpose: 'Register leave and agree longer absences in time.', owner_role: 'HR', scope: 'All employees', records: 'Kept for 2 years',
        request_form: 'Leave request', title: '"Leave " & initiator.name & " - " & days & " days"',
        steps: [
          { id: 'long', type: 'decision', name: 'More than 3 days?', branches: [{ label: 'Yes', when: 'days > 3', to: 'mgr' }, { label: 'No', to: 'ok' }] },
          { id: 'mgr', type: 'task', name: 'Manager approval', form: 'Approval decision', who: { type: 'tags', tags: ['Function: Manager'], same_as_initiator: ['Department'] }, due_hours: 48, instructions: 'Check the team planning. When rejecting, propose another period.', next: 'verdict' },
          { id: 'verdict', type: 'decision', name: 'Approved?', branches: [{ label: 'Yes', when: 'decision == "Approve"', to: 'ok' }, { label: 'No', to: 'no' }] },
          { id: 'ok', type: 'end', name: 'Approved' }, { id: 'no', type: 'end', name: 'Rejected' }] }] } },

  { id: 'onboarding', pack: 'People', name: 'New employee onboarding', summary: 'IT prepares the workplace, HR does the paperwork, the manager welcomes the new colleague.', area: 'People & HR',
    bundle: { forms: [
      { name: 'New employee', fields: [
        { key: 'employee_name', label: 'Name of the new employee', type: 'text', required: true },
        { key: 'start_date', label: 'First working day', type: 'date', required: true },
        { key: 'job_title', label: 'Job title', type: 'text', required: true, width: 'half' },
        { key: 'department', label: 'Department', type: 'text', required: true, width: 'half' },
        { key: 'manager', label: 'Manager', type: 'person', required: true }] },
      taskDone('Workplace ready', 'Laptop, accounts, access badge'),
      taskDone('Paperwork done', 'Contract, payroll, insurance'),
      taskDone('Welcome done', 'First day conversation and introduction')],
      processes: [{ name: 'New employee onboarding', description: 'Prepare and welcome a new colleague.', purpose: 'A new colleague has everything on day one.', owner_role: 'HR', scope: 'All new employees', records: 'Kept in the personnel file',
        request_form: 'New employee', title: '"Onboarding " & employee_name',
        steps: [
          { id: 'it', type: 'task', name: 'Prepare workplace and accounts', form: 'Workplace ready', who: { type: 'tags', tags: ['Role: IT support'] }, due_hours: 72, instructions: 'Laptop, e-mail, system access, access badge.', next: 'hr' },
          { id: 'hr', type: 'task', name: 'HR paperwork', form: 'Paperwork done', who: { type: 'tags', tags: ['Function: HR'] }, due_hours: 72, next: 'welcome' },
          { id: 'welcome', type: 'task', name: 'Welcome by the manager', form: 'Welcome done', who: { type: 'field', field: 'manager' }, due_hours: 24, instructions: 'Show the workplace, introduce the team, plan the first weeks.', next: 'done' },
          { id: 'done', type: 'end', name: 'Onboarded' }] }] } },

  // ------------------------------------------------------------------ purchasing & finance
  { id: 'purchase', pack: 'Purchasing & finance', name: 'Purchase request', summary: 'Above 250 the manager approves, above 1,000 Finance approves as well. A reviewer can send a request back for correction; it returns to the requester with the earlier answers filled in.', area: 'Purchasing & Finance',
    bundle: { forms: [{ name: 'Purchase request', fields: [
      { key: 'item', label: 'What do you need?', type: 'text', required: true },
      { key: 'supplier', label: 'Supplier', type: 'text', required: true, width: 'half' },
      { key: 'needed_by', label: 'Needed by', type: 'date', width: 'half', default: 'ADDDAYS(TODAY(), 14)' },
      { key: 'quantity', label: 'Quantity', type: 'number', min: 1, default: '1', required: true, width: 'half' },
      { key: 'unit_price', label: 'Unit price (excl. VAT)', type: 'number', min: 0, required: true, width: 'half' },
      { key: 'total', label: 'Total excl. VAT', type: 'calc', formula: 'quantity * unit_price', decimals: 2 },
      { key: 'reason', label: 'Why is it needed?', type: 'textarea', required: true }] },
      { name: 'Review decision', description: 'Approve, send back for correction, or reject.', fields: [
        { key: 'decision', label: 'Decision', type: 'radio', options: ['Approve', 'Needs correction', 'Reject'], required: true },
        { key: 'comment', label: 'Reason', type: 'textarea', required: true, visibleIf: 'decision != "Approve"', help: 'Say exactly what has to change, so the requester can correct it in one go.' }] }],
      processes: [{ name: 'Purchase request', description: 'Order goods or services.', purpose: 'Control spending: every purchase approved by the right person.', owner_role: 'Finance', scope: 'All purchases from suppliers', records: 'Kept for 7 years',
        request_form: 'Purchase request', title: '"Purchase: " & item & " (" & ROUND(total, 0) & ")"',
        steps: [
          { id: 'small', type: 'decision', name: 'Above 250?', branches: [{ label: 'Yes', when: 'total > 250', to: 'mgr' }, { label: 'No', to: 'ok' }] },
          { id: 'mgr', type: 'task', name: 'Manager approval', form: 'Review decision', who: { type: 'tags', tags: ['Function: Manager'], same_as_initiator: ['Department'] }, due_hours: 48, next: 'v1' },
          { id: 'v1', type: 'decision', name: 'Manager decision', branches: [{ label: 'Needs correction', when: 'decision == "Needs correction"', to: 'fix' }, { label: 'Approved, above 1,000', when: 'decision == "Approve" and total > 1000', to: 'fin' }, { label: 'Approved', when: 'decision == "Approve"', to: 'ok' }, { label: 'Rejected', to: 'no' }] },
          { id: 'fix', type: 'task', name: 'Correct the request', form: 'Purchase request', who: 'initiator', due_hours: 72, instructions: 'Read the reason in the earlier steps, correct the request and send it on. Your earlier answers are filled in.', next: 'small' },
          { id: 'fin', type: 'task', name: 'Finance approval', form: 'Review decision', who: { type: 'tags', tags: ['Function: Finance'] }, due_hours: 72, next: 'v2' },
          { id: 'v2', type: 'decision', name: 'Finance decision', branches: [{ label: 'Needs correction', when: 'decision == "Needs correction"', to: 'fix' }, { label: 'Approved', when: 'decision == "Approve"', to: 'ok' }, { label: 'Rejected', to: 'no' }] },
          { id: 'ok', type: 'end', name: 'Approved' }, { id: 'no', type: 'end', name: 'Rejected' }] }] } },

  // ------------------------------------------------------------------ quality & equipment
  { id: 'calibration', pack: 'Quality & equipment', name: 'Machine calibration', summary: 'Calibrate a machine (an object with its own page); the result updates the machine record and its next due date.', area: 'Quality & Equipment',
    bundle: { forms: [
      { name: 'Machine', description: 'Equipment that needs calibration.', class: true, fields: [
        { key: 'name', label: 'Name', type: 'text', required: true },
        { key: 'machine_id', label: 'Machine number', type: 'text', required: true, width: 'half', format: 'code' },
        { key: 'location', label: 'Location', type: 'text', width: 'half' },
        { key: 'status', label: 'Status', type: 'select', options: ['In service', 'Out of service'], required: true, default: '"In service"', width: 'half' },
        { key: 'interval_days', label: 'Calibration interval (days)', type: 'number', min: 1, required: true, default: '365', width: 'half' },
        { key: 'last_calibrated', label: 'Last calibrated', type: 'date', width: 'half' },
        { key: 'next_due', label: 'Next calibration due', type: 'date', width: 'half' }] },
      { name: 'Calibration result', fields: [
        { key: 'measured_on', label: 'Calibrated on', type: 'date', required: true, default: 'TODAY()', validate: 'measured_on <= TODAY()', validateMsg: 'Cannot be in the future.', width: 'half' },
        { key: 'result', label: 'Result', type: 'radio', options: ['Within tolerance', 'Out of tolerance'], required: true, width: 'half' },
        { key: 'deviation', label: 'Largest deviation (%)', type: 'number', min: 0, decimals: 2 },
        { key: 'remarks', label: 'Remarks', type: 'textarea', required: true, visibleIf: 'result == "Out of tolerance"' }] }],
      processes: [{ name: 'Machine calibration', description: 'Calibrate a machine; the result updates the machine.', purpose: 'Keep machines within tolerance, with a trace of who calibrated what and when.', owner_role: 'Quality', scope: 'All machines in the Machine register', records: 'Kept with the machine record',
        works_on: 'Machine', title: '"Calibration " & subject.label',
        steps: [
          { id: 'cal', type: 'task', name: 'Calibrate', form: 'Calibration result', who: { type: 'tags', tags: ['Role: Metrologist'] }, due_hours: 72, instructions: 'Use the reference standard. Record the largest deviation.', next: 'ok' },
          { id: 'ok', type: 'decision', name: 'Within tolerance?', branches: [{ label: 'Yes', when: 'result == "Within tolerance"', to: 'in' }, { label: 'No', to: 'out' }] },
          { id: 'in', type: 'record', name: 'Set machine in service', form: 'Machine', mode: 'update', set: ['status = "In service"', 'last_calibrated = measured_on', 'next_due = ADDDAYS(measured_on, subject.interval_days)'], next: 'e1' },
          { id: 'out', type: 'record', name: 'Take machine out of service', form: 'Machine', mode: 'update', set: ['status = "Out of service"', 'last_calibrated = measured_on'], next: 'e2' },
          { id: 'e1', type: 'end', name: 'Calibrated' }, { id: 'e2', type: 'end', name: 'Out of service' }] }] } },

  { id: 'supplier', pack: 'Quality & equipment', name: 'Supplier approval', summary: 'Collect the supplier\'s data and certificate; quality reviews and scores; approved suppliers are registered.', area: 'Quality & Equipment',
    bundle: { forms: [
      { name: 'Supplier assessment', fields: [
        { key: 'supplier_name', label: 'Supplier', type: 'text', required: true },
        { key: 'country', label: 'Country', type: 'text', required: true, width: 'half' },
        { key: 'contact', label: 'Contact e-mail', type: 'email', width: 'half' },
        { key: 'iso9001', label: 'Quality system', type: 'checkbox', checkLabel: 'Certified (e.g. ISO 9001)' },
        { key: 'certificate', label: 'Certificate', type: 'file' },
        { key: 'what_supplied', label: 'What will they supply?', type: 'textarea', required: true }] },
      { name: 'Quality review', fields: [
        { key: 'score', label: 'Score (0-100)', type: 'number', min: 0, max: 100, required: true, help: '70 or more is approved.' },
        { key: 'review_notes', label: 'Notes', type: 'textarea' }] }],
      processes: [{ name: 'Supplier approval', description: 'Assess a new supplier.', purpose: 'Only approved suppliers are used.', owner_role: 'Quality', scope: 'All new suppliers', records: 'Reassess every 3 years',
        request_form: 'Supplier assessment', title: '"Supplier: " & supplier_name',
        steps: [
          { id: 'review', type: 'task', name: 'Quality review', form: 'Quality review', who: { type: 'tags', tags: ['Role: Quality manager'] }, due_hours: 120, instructions: 'Check the certificate and the answers. Score the supplier.', next: 'pass' },
          { id: 'pass', type: 'decision', name: 'Score 70 or more?', branches: [{ label: 'Yes', when: 'score >= 70', to: 'ok' }, { label: 'No', to: 'no' }] },
          { id: 'ok', type: 'end', name: 'Approved supplier' }, { id: 'no', type: 'end', name: 'Not approved' }] }] } },

  // ------------------------------------------------------------------ IT
  { id: 'access', pack: 'IT', name: 'Access request', summary: 'Ask for access to a system; the manager approves; IT grants it.', area: 'IT',
    bundle: { forms: [
      { name: 'Access request', fields: [
        { key: 'system', label: 'System', type: 'select', options: ['E-mail and calendar', 'File server', 'ERP', 'CRM', 'Other'], required: true },
        { key: 'level', label: 'Access level', type: 'radio', options: ['Read', 'Edit', 'Administrator'], required: true },
        { key: 'why', label: 'Why is it needed?', type: 'textarea', required: true }] },
      approval, taskDone('Access granted', 'IT has set up the access')],
      processes: [{ name: 'Access request', description: 'Request access to a system.', purpose: 'Access is given on purpose and can be traced.', owner_role: 'IT', scope: 'All systems', records: 'Kept for 2 years',
        request_form: 'Access request', title: '"Access: " & system & " (" & level & ") for " & initiator.name',
        steps: [
          { id: 'mgr', type: 'task', name: 'Manager approval', form: 'Approval decision', who: { type: 'tags', tags: ['Function: Manager'], same_as_initiator: ['Department'] }, due_hours: 48, next: 'v' },
          { id: 'v', type: 'decision', name: 'Approved?', branches: [{ label: 'Yes', when: 'decision == "Approve"', to: 'it' }, { label: 'No', to: 'no' }] },
          { id: 'it', type: 'task', name: 'Grant access', form: 'Access granted', who: { type: 'tags', tags: ['Role: IT support'] }, due_hours: 24, next: 'ok' },
          { id: 'ok', type: 'end', name: 'Access granted' }, { id: 'no', type: 'end', name: 'Rejected' }] }] } },
];
