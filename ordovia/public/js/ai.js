/* Ordovia "describe with AI": the user describes a process in their own words, Ordovia writes the instructions for an AI,
 * the user takes them to any AI they already use (Copilot, ChatGPT, Claude...) and pastes the answer back; it is checked and created as a draft.
 * No AI service is called by Ordovia and no key is needed. */
(function () {
  'use strict';
  const FB = window.FB;
  const { esc, $, $$, toast } = FB.ui;
  const api = FB.api;

  const EXAMPLE = `{
  "area": "People & HR",
  "forms": [
    { "name": "Leave request", "description": "Ask for days off", "fields": [
      { "key": "start_date", "label": "First day", "type": "date", "required": true, "default": "TODAY()", "width": "half" },
      { "key": "end_date", "label": "Last day", "type": "date", "required": true, "width": "half" },
      { "key": "days", "label": "Working days", "type": "calc", "formula": "WORKDAYS(start_date, end_date)" } ] },
    { "name": "Approval", "fields": [
      { "key": "decision", "label": "Decision", "type": "radio", "options": ["Approve", "Reject"], "required": true },
      { "key": "comment", "label": "Why rejected?", "type": "textarea", "required": true, "visibleIf": "decision == \\"Reject\\"" } ] }
  ],
  "processes": [ {
    "name": "Leave request", "description": "Ask for days off; long leave goes to your manager",
    "purpose": "Make sure leave is registered and agreed in time", "owner_role": "HR", "scope": "All employees", "records": "Kept for 2 years",
    "request_form": "Leave request",
    "title": "\\"Leave \\" & initiator.name & \\" - \\" & days & \\" days\\"",
    "steps": [
      { "id": "check", "type": "decision", "name": "More than 3 days?", "branches": [
        { "label": "Yes", "when": "days > 3", "to": "approve" }, { "label": "No", "to": "ok" } ] },
      { "id": "approve", "type": "task", "name": "Manager approval", "form": "Approval", "instructions": "Check the team planning.",
        "who": { "type": "tags", "tags": ["Function: Manager"], "same_as_initiator": ["Department"] }, "due_hours": 48, "next": "verdict" },
      { "id": "verdict", "type": "decision", "name": "Approved?", "branches": [
        { "label": "Yes", "when": "decision == \\"Approve\\"", "to": "ok" }, { "label": "No", "to": "no" } ] },
      { "id": "ok", "type": "end", "name": "Approved" },
      { "id": "no", "type": "end", "name": "Rejected" } ] } ]
}`;

  /** The instructions for the AI: what to produce, the exact format with an example, the rules, the user's workspace, and the description. */
  function buildPrompt(ctx, description, area) {
    const existing = ctx.forms.length ? ctx.forms.map(f => `- ${f.name}${f.isClass ? ' (a class of objects)' : ''}: ${f.fields.map(x => x.key + ' [' + x.type + ']').join(', ') || 'no fields'}`).join('\n') : '- (none yet)';
    return `You are helping me set up a business process in "Ordovia". In Ordovia a process is a flowchart of steps. A step is a task for a person (who fills in a form), a decision (a rule chooses the way), a calculation, an update of a record, or an end. Forms collect the information; the routing and rules make sure the right person does the right step in the right order.

Reply with ONE JSON object inside a single code block (\`\`\`json ... \`\`\`) and nothing else after it. Ordovia reads that JSON and builds the process as a draft that I will review.

== THE FORMAT ==
{ "area": "name of the department/area (optional)",
  "forms": [ { "name": "...", "description": "...", "class": false, "fields": [ { "key": "snake_case_key", "label": "Label for people", "type": "...", "required": true } ] } ],
  "processes": [ { "name": "...", "description": "...", "purpose": "...", "owner_role": "...", "scope": "...", "records": "...",
      "request_form": "name of the form the person fills in when starting (optional)",
      "who_can_start": ["Category: Value"],            (optional; tags)
      "works_on": "name of a class this process is about (optional, e.g. Machine)",
      "title": "formula for the title of each case (optional)",
      "steps": [ ... ] } ] }

Field types: ${ctx.fieldTypes.join(', ')}.
- select / radio need "options": ["A", "B"]. calc needs "formula". record needs "record_form" (a form name). person may have "person_tags".
- Optional on a field: "default", "visibleIf" (formula; the field only shows when true), "validate" + "validateMsg" (formula that must be true), "min", "max", "decimals", "help", "width": "half", "format" (url, phone, iban, postcode_nl, code).
Step types (every step has a unique "id" and a "name"; the first step in the list is where the process starts):
- task: { "id", "type": "task", "name", "form": "form name (optional)", "instructions": "...", "who": ..., "due_hours": 48, "next": "id of the next step" }
  "who" is one of: "initiator" (the person who started it) | { "type": "tags", "tags": ["Function: Manager"], "same_as_initiator": ["Department"] } | { "type": "attribute", "attribute": "Job title", "value": "Metrologist" } | { "type": "field", "field": "key of a person field filled in earlier" } | { "type": "person", "person": "Full name" }
- decision: { "id", "type": "decision", "name", "branches": [ { "label": "Yes", "when": "formula", "to": "step id" }, { "label": "No", "to": "step id" } ] }   (the last branch has no "when": it is the "otherwise")
- calc: { "id", "type": "calc", "name", "set": ["total = quantity * unit_price"], "next": "..." }
- record: { "id", "type": "record", "name", "form": "form name", "mode": "create" or "update", "set": ["field_key = formula"], "record_id": "formula giving the id (update only; subject.id when the process works on an object)", "next": "..." }
- end: { "id", "type": "end", "name": "the outcome, e.g. Approved" }   (one end per outcome)

== FORMULAS ==
Field keys are the variable names (e.g. days > 3). Text in double quotes; join text with &. Operators: + - * / ^ %, == != < <= > >=, and, or, not. Functions: ${ctx.functions.join(', ')}. The person who started the process: initiator.name, initiator.email${ctx.personFields.length ? ', ' + ctx.personFields.map(f => 'initiator.' + f.label.toLowerCase().replace(/[^a-z0-9]+/g, '_')).join(', ') : ''} and their tags by category (initiator.department). A linked record's fields: supplier.country. When the process works on an object: subject.<field key>.

== RULES ==
- Keep it small and practical: only the forms and fields people really need; short step names. Do not invent webhook or integration steps.
- If a reviewer may need to send work back, do not invent questions or messages: add a decision branch "Needs correction" that leads to a task for the person who started it (same form as the request, with its earlier answers) and then back to the review step. The reviewer's form should have the choice and a required reason.
- Every step except an end needs "next" (or branches). Every path must reach an end. Use clear outcomes for the end steps.
- Reuse the existing forms listed below by name instead of defining them again (leave them out of "forms").
- Write names, labels and instructions in the same language as my description.
- Keys: lower case letters, digits and underscores only.

== EXAMPLE (a different process, to show the format) ==
\`\`\`json
${EXAMPLE}
\`\`\`

== MY WORKSPACE ==
Areas: ${ctx.areas.join(', ') || '(none yet)'}
Tags for people (Category: Value): ${ctx.tags.join(', ') || '(none yet; invent sensible ones like "Function: Manager" and "Department: Sales")'}
Person attributes: ${ctx.personFields.length ? ctx.personFields.map(f => f.label + (f.options.length ? ' (' + f.options.join(' / ') + ')' : '')).join('; ') : '(none)'}
Existing forms and classes (use by name, do not redefine):
${existing}
${area ? `Put the process in the area: ${area}\n` : ''}
== THE PROCESS TO DESIGN ==
${description.trim()}
`;
  }

  FB.route('/admin/ai', async (main) => {
    const ctx = await api.get('/admin/ai/context');
    main.innerHTML = `<div class="page"><div class="page-head"><div><h1>Describe with AI</h1><p class="muted">Describe a process in your own words. Ordovia writes the instructions for an AI you already use (Copilot, ChatGPT, Claude…). You paste its answer back and Ordovia builds the draft: forms, steps, who does what. Nothing is sent anywhere by Ordovia, and nothing goes live until you have looked at it.</p></div></div>
      <div class="card ai-step"><h3>1. Describe the process</h3>
        <label>What should happen, in your own words<textarea id="aiDesc" rows="6" placeholder="e.g. Employees ask for leave. Up to 3 days is approved automatically. Longer leave goes to their own manager, who approves or rejects within 2 days. HR is told about approved leave."></textarea></label>
        <label>Area <small class="muted">(optional)</small><select id="aiArea"><option value="">– let the AI suggest –</option>${ctx.areas.map(a => `<option>${esc(a)}</option>`).join('')}</select></label>
        <button class="btn primary" id="aiMake">Write the instructions for the AI</button></div>
      <div class="card ai-step" id="aiS2" hidden><h3>2. Give them to an AI</h3>
        <p class="muted">Copy this text, paste it into your AI (a new chat), and wait for its answer. Then come back here.</p>
        <textarea id="aiPrompt" class="mono small" rows="8" readonly></textarea>
        <div class="form-actions left"><button class="btn primary" id="aiCopy">Copy the instructions</button><span class="muted small" id="aiLen"></span></div></div>
      <div class="card ai-step" id="aiS3" hidden><h3>3. Paste the answer</h3>
        <textarea id="aiAns" class="mono small" rows="8" placeholder="Paste the whole answer of the AI here (the code block with the JSON)…"></textarea>
        <div class="form-actions left"><button class="btn primary" id="aiCheck">Check the answer</button></div><div id="aiResult"></div></div></div>`;
    let lastErrors = [];
    $('#aiMake', main).onclick = () => {
      const d = $('#aiDesc', main).value;
      if (d.trim().length < 15) { toast('Describe the process in a sentence or two first.', 'error'); return; }
      const p = buildPrompt(ctx, d, $('#aiArea', main).value);
      $('#aiPrompt', main).value = p; $('#aiLen', main).textContent = Math.round(p.length / 100) / 10 + ' KB of text';
      $('#aiS2', main).hidden = false; $('#aiS3', main).hidden = false;
      $('#aiS2', main).scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    $('#aiCopy', main).onclick = async () => { try { await navigator.clipboard.writeText($('#aiPrompt', main).value); toast('Copied. Paste it into your AI.', 'ok'); } catch (e) { $('#aiPrompt', main).select(); toast('Select the text and copy it (Ctrl+C).', 'warn'); } };
    $('#aiCheck', main).onclick = async () => {
      const box = $('#aiResult', main), text = $('#aiAns', main).value;
      box.innerHTML = '<p class="muted">Checking…</p>';
      let r; try { r = await api.post('/admin/ai/preview', { text }); } catch (e) { box.innerHTML = `<p class="danger-text">${esc(e.message)}</p>`; return; }
      lastErrors = r.errors;
      if (!r.ok) {
        box.innerHTML = `<h4>This cannot be built yet</h4><ul class="issues">${r.errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul>
          <p class="muted small">Send these problems back to the AI and ask for a corrected answer:</p><button class="btn" id="aiFixCopy">Copy a message for the AI</button>`;
        $('#aiFixCopy', box).onclick = async () => { try { await navigator.clipboard.writeText(`Your answer had these problems, so Ordovia could not build it:\n${lastErrors.map(e => '- ' + e).join('\n')}\n\nPlease return the complete corrected JSON again, in one code block, with nothing else after it.`); toast('Copied. Paste it into the same AI chat.', 'ok'); } catch (e) { toast('Copy failed', 'error'); } };
        return;
      }
      const s = r.summary;
      box.innerHTML = `<h4>This is what will be created <span class="status s-draft">draft</span></h4>
        ${s.area ? `<p><b>Area:</b> ${esc(s.area.name)}${s.area.isNew ? ' <span class="muted">(new)</span>' : ''}</p>` : ''}
        ${s.tags.length ? `<p><b>New tags:</b> ${s.tags.map(t => `<span class="tag">${esc(t.category)}: ${esc(t.value)}</span>`).join(' ')}</p>` : ''}
        ${s.forms.length ? `<p><b>Forms:</b> ${s.forms.map(f => `${esc(f.name)} <span class="muted">(${f.fields} fields${f.isClass ? ', class' : ''})</span>`).join(' · ')}</p>` : ''}
        ${s.usedForms.length ? `<p><b>Existing forms used:</b> ${s.usedForms.map(esc).join(', ')}</p>` : ''}
        ${s.flows.map(f => `<h4>${esc(f.name)}</h4><ol class="ai-outline">${f.steps.map(x => `<li><b>${esc(x.name)}</b> <span class="tag">${esc(x.type)}</span>${x.who ? ` <span class="muted">${esc(x.who)}</span>` : ''}${x.form ? ` <span class="muted">· form ${esc(x.form)}</span>` : ''}</li>`).join('')}</ol>`).join('')}
        ${r.warnings.length ? `<p class="small"><b>Look at:</b></p><ul class="issues">${r.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
        <div class="form-actions left"><button class="btn primary" id="aiApply">Create as draft</button></div>`;
      $('#aiApply', box).onclick = async (e) => {
        e.target.disabled = true; e.target.textContent = 'Creating…';
        try { const x = await api.post('/admin/ai/apply', { text }); await FB.loadMeta(); toast('Created as draft. Check it and activate it when it is right.', 'ok'); FB.go('#/admin/flows/' + (x.flows[0] ? x.flows[0].id : '')); }
        catch (err) { toast(err.message, 'error'); e.target.disabled = false; e.target.textContent = 'Create as draft'; }
      };
    };
  }, { admin: true });
})();
