/* Ordovia form logic (shared by browser and Cloudflare Worker).
 * The browser uses it for live feedback; the Worker runs the exact same rules again
 * before anything is stored, so calculations and checks cannot be bypassed.
 */
(function () {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;
  const FB = root.FB = root.FB || {};

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  const KEY_RE = /^[a-z_][a-z0-9_]*$/;
  /** Formats: what a value must look like, and its one canonical spelling (so data arrives the same everywhere it goes). */
  const ibanOk = (s) => {
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
    let rem = 0; for (const ch of s.slice(4) + s.slice(0, 4)) rem = (rem * (ch >= 'A' ? 100 : 10) + (ch >= 'A' ? ch.charCodeAt(0) - 55 : +ch)) % 97;
    return rem === 1;
  };
  const FORMATS = {
    url: { label: 'Web address (https://…)', normalize: (v) => v.trim(), check: (v) => (/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(v) ? '' : 'Use a full web address, starting with http:// or https://.') },
    phone: { label: 'Phone number', normalize: (v) => v.replace(/[\s().-]+/g, ' ').trim(), check: (v) => (/^\+?[0-9 ]{7,18}$/.test(v) ? '' : 'Use a phone number, e.g. +31 6 12345678.') },
    iban: { label: 'IBAN', normalize: (v) => v.replace(/\s+/g, '').toUpperCase(), check: (v) => (ibanOk(v) ? '' : 'This is not a valid IBAN.') },
    postcode_nl: { label: 'Dutch postcode', normalize: (v) => v.replace(/\s+/g, '').toUpperCase().replace(/^(\d{4})([A-Z]{2})$/, '$1 $2'), check: (v) => (/^\d{4} [A-Z]{2}$/.test(v) ? '' : 'Use a Dutch postcode, e.g. 1234 AB.') },
    code: { label: 'Code (capitals, digits, dashes)', normalize: (v) => v.replace(/\s+/g, '').toUpperCase(), check: (v) => (/^[A-Z0-9][A-Z0-9_-]*$/.test(v) ? '' : 'Use capitals, digits and dashes only.') },
  };
  const isEmpty = (v) => v == null || v === '' || v === false || (Array.isArray(v) && !v.length);
  const hasVal = (x) => x !== '' && x != null;

  /** Normalise a raw input value to the field's type. Returns {value, error}. */
  function coerce(f, v) {
    if (v === undefined || v === '' || v === null) return { value: f.type === 'checkbox' ? false : null };
    switch (f.type) {
      case 'number': { const n = Number(v); return Number.isFinite(n) ? { value: n } : { value: null, error: 'Not a number.' }; }
      case 'checkbox': return { value: v === true || v === 'true' || v === 1 || v === 'on' };
      case 'person': case 'record': case 'file': { const n = Number(v); return Number.isInteger(n) ? { value: n } : { value: null, error: 'Invalid choice.' }; }
      case 'date': return DATE_RE.test(String(v)) ? { value: String(v) } : { value: null, error: 'Use a valid date.' };
      case 'select': case 'radio': return (f.options || []).includes(String(v)) ? { value: String(v) } : { value: null, error: 'Not one of the options.' };
      default: { const t = String(v).slice(0, 20000); return { value: f.type === 'text' && FORMATS[f.format] ? FORMATS[f.format].normalize(t) : t }; }
    }
  }

  const Logic = {
    KEY_RE,
    FORMATS,
    /**
     * Compute calculations and visibility.
     * input: raw values by key · context: process variables · linked: {"supplier.country": "NL", ...}
     */
    compute(fields, input, context, linked) {
      const values = Object.assign({}, input);
      const ctx = () => Object.assign({}, context || {}, linked || {}, values);
      for (let pass = 0; pass < 3; pass++) {
        for (const f of fields) if (f.type === 'calc') values[f.key] = FB.expr.safe(f.formula, ctx(), null);
      }
      const visible = {};
      for (const f of fields) visible[f.key] = !f.visibleIf || FB.expr.truthy(FB.expr.safe(f.visibleIf, ctx(), false));
      return { values, visible, ctx: ctx() };
    },

    /** Return {key: message} for every visible field that breaks a rule. */
    validate(fields, values, visible, ctx) {
      const errors = {};
      for (const f of fields) {
        if (f.type === 'heading' || f.type === 'calc' || !visible[f.key]) continue;
        const v = values[f.key];
        let msg = '';
        if (f.required && isEmpty(v)) msg = 'This field is required.';
        else if (f.type === 'number' && v != null) {
          if (hasVal(f.min) && v < Number(f.min)) msg = `Minimum is ${f.min}.`;
          else if (hasVal(f.max) && v > Number(f.max)) msg = `Maximum is ${f.max}.`;
          else if (f.integer && !Number.isInteger(v)) msg = 'Whole numbers only.';
        } else if (f.type === 'email' && v && !EMAIL_RE.test(v)) msg = 'Not a valid e-mail address.';
        else if (f.type === 'text' && v && FORMATS[f.format]) msg = FORMATS[f.format].check(String(v));
        else if (f.type === 'text' && v && f.pattern) { try { if (!new RegExp(f.pattern).test(String(v))) msg = f.patternMsg || 'Does not have the required format.'; } catch (e) { /* a broken pattern is reported when the form is saved */ } }
        if (!msg && ['text', 'textarea', 'email'].includes(f.type) && v) {   // length rules
          const len = String(v).length;
          if (hasVal(f.minLength) && len < Number(f.minLength)) msg = `Use at least ${f.minLength} characters.`;
          else if (hasVal(f.maxLength) && len > Number(f.maxLength)) msg = `Use at most ${f.maxLength} characters.`;
        }
        if (!msg && f.type === 'date' && v) {   // earliest / latest date (formulas such as TODAY() or ADDDAYS(TODAY(), 30))
          const lo = f.minDate ? FB.expr.safe(f.minDate, ctx, null) : null, hi = f.maxDate ? FB.expr.safe(f.maxDate, ctx, null) : null;
          if (lo && String(v) < String(lo)) msg = `The date cannot be before ${lo}.`;
          else if (hi && String(v) > String(hi)) msg = `The date cannot be after ${hi}.`;
        }
        if (!msg && f.validate && !isEmpty(v) && !FB.expr.truthy(FB.expr.safe(f.validate, ctx, true))) msg = f.validateMsg || 'Value is not valid.';
        if (msg) errors[f.key] = msg;
      }
      return errors;
    },

    /** Form-level logic checks (rules spanning several fields). Returns list of messages. */
    checks(form, ctx) {
      return (form.checks || []).filter(c => c.rule && !FB.expr.truthy(FB.expr.safe(c.rule, ctx, true))).map(c => c.message || `Check failed: ${c.rule}`);
    },

    /**
     * Full server-side pipeline: coerce → compute → validate → clean.
     * lookup(field, id) must return {label, data} for person/record fields, or null if not allowed.
     */
    finalize(form, input, context, lookup) {
      const fields = form.fields;
      const raw = {}, errors = {}, linked = {};
      for (const f of fields) {
        if (f.type === 'heading' || f.type === 'calc') continue;
        const c = coerce(f, input ? input[f.key] : undefined);
        raw[f.key] = c.value;
        if (c.error) errors[f.key] = c.error;
        if ((f.type === 'person' || f.type === 'record' || f.type === 'file') && c.value != null) {
          const hit = lookup(f, c.value);
          if (!hit) { errors[f.key] = 'Invalid choice.'; raw[f.key] = null; continue; }
          raw[f.key + '_label'] = hit.label;
          for (const [k, val] of Object.entries(hit.data || {})) linked[f.key + '.' + k] = val;
        }
      }
      const { values, visible, ctx } = this.compute(fields, raw, context, linked);
      Object.assign(errors, Object.assign(this.validate(fields, values, visible, ctx), errors)); // type/lookup errors win
      const formErrors = Object.keys(errors).length ? [] : this.checks(form, ctx);
      const data = {};
      for (const f of fields) {
        if (f.type === 'heading') continue;
        data[f.key] = visible[f.key] ? (values[f.key] ?? null) : null;
        if (f.type === 'person' || f.type === 'record' || f.type === 'file') data[f.key + '_label'] = visible[f.key] ? (values[f.key + '_label'] ?? null) : null;
      }
      return { data, linked, errors, formErrors, ok: !Object.keys(errors).length && !formErrors.length };
    },

    /** Static checks on a form definition (used when saving in the builder and on the server). */
    lint(form) {
      const problems = [], keys = new Set();
      for (const f of form.fields || []) {
        if (!KEY_RE.test(f.key || '')) problems.push(`Field key “${f.key}” must be lower-case letters, digits or _.`);
        if (keys.has(f.key)) problems.push(`Field key “${f.key}” is used twice.`);
        keys.add(f.key);
        for (const prop of ['formula', 'visibleIf', 'default', 'validate', 'minDate', 'maxDate']) {
          const err = f[prop] ? FB.expr.check(f[prop]) : null;
          if (err) problems.push(`${f.label || f.key} – ${prop}: ${err}`);
        }
        if (f.type === 'record' && !f.recordForm) problems.push(`${f.label || f.key}: choose the linked form.`);
        if (f.type === 'text' && f.pattern) {
          try { new RegExp(f.pattern); } catch (e) { problems.push(`${f.label || f.key}: the pattern is not a valid regular expression.`); }
          if (String(f.pattern).length > 200) problems.push(`${f.label || f.key}: the pattern is too long.`);
        }
      }
      for (const c of form.checks || []) { const err = c.rule ? FB.expr.check(c.rule) : null; if (err) problems.push(`Check “${c.message || c.rule}”: ${err}`); }
      return problems;
    },

    /** SQL for a dashboard widget built with the visual builder (or its own SQL). */
    widgetSQL(w) {
      const qi = (s) => '"' + String(s).replace(/"/g, '""') + '"';
      if (w.mode === 'sql') return w.sql || '';
      if (!w.src) return '';
      const where = w.where && String(w.where).trim() ? ` WHERE ${w.where}` : '';
      const limit = Number(w.limit) > 0 ? Math.min(1000, Math.floor(Number(w.limit))) : 0;
      if (w.type === 'table' && !w.groupBy) return `SELECT * FROM ${qi(w.src)}${where} ORDER BY 1 DESC LIMIT ${limit || 50}`;
      const agg = ['count', 'sum', 'avg', 'min', 'max'].includes(w.agg) ? w.agg : 'count';
      const value = agg === 'count' || !w.field ? 'COUNT(*)' : `ROUND(${agg.toUpperCase()}(${qi(w.field)}), 2)`;
      if (w.type === 'kpi' || !w.groupBy) return `SELECT ${value} AS value FROM ${qi(w.src)}${where}`;
      const col = qi(w.groupBy);
      const label = { month: `substr(${col}, 1, 7)`, day: `substr(${col}, 1, 10)`, year: `substr(${col}, 1, 4)` }[w.groupFn] || `coalesce(${col}, '(empty)')`;
      const order = w.groupFn || w.type === 'line' ? '1' : '2 DESC';
      return `SELECT ${label} AS label, ${value} AS value FROM ${qi(w.src)}${where} GROUP BY 1 ORDER BY ${order}${limit ? ' LIMIT ' + limit : ''}`;
    },

    /** "name = expression" lines used by Calculate and Record steps. */
    assignments(text) {
      return String(text || '').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('//')).map(l => {
        const i = l.indexOf('=');
        return i < 0 ? { name: l, expr: 'null' } : { name: l.slice(0, i).trim(), expr: l.slice(i + 1).trim() || 'null' };
      });
    },

    /** Structural and logic checks on a flowchart. formIds: ids of existing forms. */
    lintFlow(graph, formIds, forms) {
      const errs = [], g = graph || { nodes: [], edges: [] };
      const known = formIds ? new Set(formIds.map(Number)) : null;
      const ids = new Set(g.nodes.map(n => n.id));
      if (g.nodes.filter(n => n.type === 'start').length !== 1) errs.push('A flow needs exactly one Start.');
      if (!g.nodes.some(n => n.type === 'end')) errs.push('A flow needs at least one End.');
      for (const n of g.nodes) {
        const out = g.edges.filter(e => e.from === n.id);
        if (n.type !== 'end' && !out.length) errs.push(`“${n.name}” has no outgoing arrow.`);
        if (n.type !== 'start' && !g.edges.some(e => e.to === n.id)) errs.push(`“${n.name}” can never be reached.`);
        if (n.type === 'task' && !n.formId) errs.push(`Task “${n.name}” has no form.`);
        if (n.type === 'task' && known && n.formId && !known.has(Number(n.formId))) errs.push(`Task “${n.name}” uses a form that no longer exists or is archived.`);
        if (n.type === 'record' && !n.formId) errs.push(`Record step “${n.name}” has no form.`);
        if (n.type === 'record' && n.mode === 'update' && !n.recordId) errs.push(`Record step “${n.name}” needs the id of the record to update.`);
        if (n.type === 'webhook' && !/^https:\/\//.test(n.url || '')) errs.push(`Webhook “${n.name}” needs an https:// address.`);
        if (out.length > 1 && !out.some(e => !e.condition)) errs.push(`“${n.name}” needs one arrow without a rule (the “otherwise” path): if no rule is true the case would get stuck.`);
        if (out.filter(e => !e.condition).length > 1) errs.push(`“${n.name}” has ${out.filter(e => !e.condition).length} arrows without a rule, but only one can be the “otherwise” path. Give the others a rule.`);
        if (out.length === 1 && out[0].condition) errs.push(`“${n.name}” only continues when its rule is true. Add an arrow without a rule for all other cases, or remove the rule.`);
        for (const prop of ['assignments', 'mapping']) {
          for (const a of this.assignments(n[prop])) { const er = FB.expr.check(a.expr); if (er) errs.push(`“${n.name}”: ${a.name} – ${er}`); }
        }
        if (n.recordId) { const er = FB.expr.check(n.recordId); if (er) errs.push(`“${n.name}” record id: ${er}`); }
        if (n.type === 'start' && n.title) { const er = FB.expr.check(n.title); if (er) errs.push(`Process title: ${er}`); }
        if (n.type === 'end' && n.notifyUrl && !/^https:\/\/[^\s/]+\.[^\s/]+/.test(n.notifyUrl)) errs.push(`End “${n.name}”: the notification address must start with https://`);
        if (n.type === 'start' && n.subjectForm && forms && !forms.some(f => Number(f.id) === Number(n.subjectForm) && f.is_class)) errs.push('The class this process works on (at Start) is no longer a class, or no longer exists.');
        if (n.type === 'task' && n.assignee && n.assignee.type === 'attr' && (!n.assignee.key || n.assignee.value == null || n.assignee.value === '')) errs.push(`Task “${n.name}”: choose the attribute and its value.`);
        if (n.type === 'start' && n.formId && known && !known.has(Number(n.formId))) errs.push('The request form (at Start) no longer exists or is archived.');
        if (n.type === 'start' && n.publicEnabled) {
          if (n.subjectForm) errs.push('A public web form cannot work on an object: remove the class at Start, or switch the web form off.');
          if (!n.formId) errs.push('A public web form needs a request form: choose one at Start.');
          const pf = forms && n.formId ? forms.find(f => Number(f.id) === Number(n.formId)) : null;
          if (pf && pf.fields.some(f => f.type === 'person' || f.type === 'record' || f.type === 'file')) errs.push('A public web form cannot use Person, Record or File fields (visitors are not signed in).');
          for (const t of g.nodes) {
            const a = t.type === 'task' ? (t.assignee || { type: 'initiator' }) : null;
            if (a && (a.type === 'initiator' || (a.type === 'tags' && (a.sameAs || []).length))) errs.push(`Task “${t.name}” depends on who started the process, but a public web form has no signed-in person: route it to a person or to tags.`);
          }
        }
      }
      for (const e of g.edges) {
        if (!ids.has(e.from) || !ids.has(e.to)) errs.push('An arrow points to a removed step.');
        if (e.condition) { const er = FB.expr.check(e.condition); if (er) errs.push(`Arrow “${e.label || e.condition}”: ${er}`); }
      }
      // the route as a whole: everything must be connected to Start, and from everywhere there must be a way to an End
      const starts = g.nodes.filter(n => n.type === 'start');
      if (starts.length === 1) {
        const walk = (from, next) => { const seen = new Set(from), stack = [...from]; while (stack.length) { const id = stack.pop(); for (const nx of next(id)) if (!seen.has(nx)) { seen.add(nx); stack.push(nx); } } return seen; };
        const forward = walk([starts[0].id], (id) => g.edges.filter(e => e.from === id && ids.has(e.to)).map(e => e.to));
        const finishes = walk(g.nodes.filter(n => n.type === 'end').map(n => n.id), (id) => g.edges.filter(e => e.to === id && ids.has(e.from)).map(e => e.from));
        for (const n of g.nodes) {
          if (n.type !== 'start' && !forward.has(n.id) && g.edges.some(e => e.to === n.id)) errs.push(`“${n.name}” can never be reached from Start: it is only connected to steps that are cut off.`);
          if (forward.has(n.id) && n.type !== 'end' && !finishes.has(n.id) && g.nodes.some(x => x.type === 'end')) errs.push(`From “${n.name}” the process can never finish: no path leads to an End (it would go round in circles).`);
        }
      }
      return errs;
    },
  };
  FB.logic = Logic;
})();
