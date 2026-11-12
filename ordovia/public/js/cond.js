/* Ordovia rule builder: "when [field] [is greater than] [3]" instead of typing a formula.
 * It writes and reads the ordinary formula (days > 3), so rules stay compatible; anything it cannot read is shown as a formula to edit by hand. */
(function () {
  'use strict';
  const FB = window.FB;
  const { esc, $, $$ } = FB.ui;

  const KEY = '[a-z_][a-z0-9_.]*';
  const OPS = {
    text: [['eq', 'is'], ['ne', 'is not'], ['contains', 'contains'], ['empty', 'is empty'], ['notempty', 'is filled in']],
    choice: [['eq', 'is'], ['ne', 'is not'], ['empty', 'is empty'], ['notempty', 'is filled in']],
    number: [['eq', 'equals'], ['ne', 'does not equal'], ['gt', 'is greater than'], ['ge', 'is at least'], ['lt', 'is less than'], ['le', 'is at most'], ['empty', 'is empty'], ['notempty', 'is filled in']],
    date: [['eq', 'is'], ['lt', 'is before'], ['gt', 'is after'], ['empty', 'is empty'], ['notempty', 'is filled in']],
    check: [['ticked', 'is ticked'], ['unticked', 'is not ticked']],
    link: [['empty', 'is empty'], ['notempty', 'is filled in']],
  };
  const SYMBOL = { eq: '==', ne: '!=', gt: '>', ge: '>=', lt: '<', le: '<=' };
  const kindOf = (f) => ['select', 'radio'].includes(f.type) ? 'choice' : f.type === 'number' || f.type === 'calc' ? 'number' : f.type === 'date' ? 'date' : f.type === 'checkbox' ? 'check' : ['person', 'record', 'file'].includes(f.type) ? 'link' : 'text';

  const lit = (v) => (v === '@today' ? 'TODAY()' : v !== '' && Number.isFinite(Number(v)) && String(Number(v)) === String(v).trim() ? String(Number(v)) : JSON.stringify(String(v)));
  const rowExpr = (r) => {
    switch (r.op) {
      case 'empty': return `ISEMPTY(${r.key})`;
      case 'notempty': return `NOT(ISEMPTY(${r.key}))`;
      case 'ticked': return r.key;
      case 'unticked': return `NOT(${r.key})`;
      case 'contains': return `CONTAINS(${r.key}, ${JSON.stringify(String(r.value))})`;
      default: return `${r.key} ${SYMBOL[r.op]} ${lit(r.value)}`;
    }
  };
  const toExpr = (rows, joiner) => rows.filter(r => r.key && r.op && (['empty', 'notempty', 'ticked', 'unticked'].includes(r.op) || r.value !== '')).map(rowExpr).join(` ${joiner} `);

  /** Split a formula on top-level "and" / "or" (outside quotes and brackets). Returns { parts, joiner } or null when it mixes both. */
  function split(expr) {
    const parts = []; let depth = 0, q = false, cur = '', joiner = null;
    for (let i = 0; i < expr.length; i++) {
      const ch = expr[i];
      if (ch === '"') { q = !q; cur += ch; continue; }
      if (!q) { if (ch === '(') depth++; if (ch === ')') depth--; }
      const m = !q && depth === 0 ? expr.slice(i).match(/^ (and|or) /i) : null;
      if (m) { const j = m[1].toLowerCase(); if (joiner && joiner !== j) return null; joiner = j; parts.push(cur.trim()); cur = ''; i += m[0].length - 1; continue; }
      cur += ch;
    }
    parts.push(cur.trim());
    return { parts, joiner: joiner || 'and' };
  }
  const unq = (s) => { try { return JSON.parse(s); } catch (e) { return null; } };
  function parseRow(s) {
    let m;
    if ((m = s.match(new RegExp(`^NOT\\(ISEMPTY\\((${KEY})\\)\\)$`)))) return { key: m[1], op: 'notempty', value: '' };
    if ((m = s.match(new RegExp(`^ISEMPTY\\((${KEY})\\)$`)))) return { key: m[1], op: 'empty', value: '' };
    if ((m = s.match(new RegExp(`^NOT\\((${KEY})\\)$`)))) return { key: m[1], op: 'unticked', value: '' };
    if ((m = s.match(new RegExp(`^CONTAINS\\((${KEY}), ("(?:[^"\\\\]|\\\\.)*")\\)$`)))) { const v = unq(m[2]); return v == null ? null : { key: m[1], op: 'contains', value: v }; }
    if ((m = s.match(new RegExp(`^(${KEY}) (==|!=|>=|<=|>|<) (.+)$`)))) {
      const op = Object.keys(SYMBOL).find(k => SYMBOL[k] === m[2]), rhs = m[3].trim();
      if (rhs === 'TODAY()') return { key: m[1], op, value: '@today' };
      if (/^-?\d+(\.\d+)?$/.test(rhs)) return { key: m[1], op, value: rhs };
      const v = rhs[0] === '"' ? unq(rhs) : null;
      return v == null ? null : { key: m[1], op, value: v };
    }
    if ((m = s.match(new RegExp(`^(${KEY})$`)))) return { key: m[1], op: 'ticked', value: '' };
    return null;
  }
  /** formula -> { rows, joiner } or null (not readable by the builder) */
  function parse(expr) {
    expr = String(expr || '').trim();
    if (!expr) return { rows: [], joiner: 'and' };
    const sp = split(expr); if (!sp) return null;
    const rows = sp.parts.map(parseRow);
    return rows.some(r => !r) ? null : { rows, joiner: sp.joiner };
  }

  /**
   * Draw the builder into `host`. o = { expr, fields: [{ key, label, type, options }], onChange(expr), empty: 'text shown when there is no rule' }.
   * Rules over a key that is not in `fields` stay readable (shown by their name).
   */
  function render(host, o) {
    const fields = o.fields || [];
    let state = parse(o.expr), raw = state === null;
    const fieldOf = (key) => fields.find(f => f.key === key) || { key, label: key, type: 'text' };
    const emit = () => { o.onChange(raw ? o.expr : toExpr(state.rows, state.joiner)); };
    const valueInput = (r, i) => {
      const f = fieldOf(r.key), k = kindOf(f);
      if (['empty', 'notempty', 'ticked', 'unticked'].includes(r.op)) return '';
      if (k === 'choice' && (f.options || []).length) return `<select data-i="${i}" data-k="value"><option value="">– choose –</option>${f.options.map(x => `<option ${String(r.value) === String(x) ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>`;
      if (k === 'number') return `<input data-i="${i}" data-k="value" type="number" step="any" value="${esc(r.value)}" placeholder="number">`;
      if (k === 'date') return `<span class="cond-date"><select data-i="${i}" data-k="dateMode"><option value="fixed" ${r.value === '@today' ? '' : 'selected'}>this date</option><option value="today" ${r.value === '@today' ? 'selected' : ''}>today</option></select>${r.value === '@today' ? '' : `<input data-i="${i}" data-k="value" type="date" value="${esc(r.value)}">`}</span>`;
      return `<input data-i="${i}" data-k="value" value="${esc(r.value)}" placeholder="value">`;
    };
    const draw = () => {
      if (raw) {
        host.innerHTML = `<div class="cond"><p class="small muted">This rule is written as a formula:</p><textarea class="mono cond-raw" rows="2">${esc(o.expr || '')}</textarea><button type="button" class="btn small ghost" data-rebuild>Use the rule builder instead (clears this rule)</button></div>`;
        $('.cond-raw', host).oninput = (e) => { o.expr = e.target.value; o.onChange(o.expr); };
        $('[data-rebuild]', host).onclick = () => { raw = false; state = { rows: [], joiner: 'and' }; o.expr = ''; o.onChange(''); draw(); };
        return;
      }
      host.innerHTML = `<div class="cond">${state.rows.length ? state.rows.map((r, i) => {
        const f = fieldOf(r.key), ops = OPS[kindOf(f)];
        return `${i ? `<div class="cond-join"><select data-j>${['and', 'or'].map(j => `<option value="${j}" ${state.joiner === j ? 'selected' : ''}>${j === 'and' ? 'and also' : 'or'}</option>`).join('')}</select></div>` : ''}<div class="cond-row">
          <select data-i="${i}" data-k="key">${fields.some(x => x.key === r.key) ? '' : `<option value="${esc(r.key)}" selected>${esc(r.key)}</option>`}${fields.map(x => `<option value="${esc(x.key)}" ${x.key === r.key ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select>
          <select data-i="${i}" data-k="op">${ops.map(([v, l]) => `<option value="${v}" ${v === r.op ? 'selected' : ''}>${l}</option>`).join('')}</select>${valueInput(r, i)}
          <button type="button" class="icon-btn danger" data-del="${i}" title="Remove this part">×</button></div>`;
      }).join('') : `<p class="small muted">${esc(o.empty || 'No rule.')}</p>`}
        <div class="cond-foot"><button type="button" class="btn small" data-add>+ ${state.rows.length ? 'Add another part' : 'Add a rule'}</button><button type="button" class="link-btn small" data-formula>Edit as formula</button></div></div>`;
      $$('[data-i]', host).forEach(inp => inp.onchange = inp.oninput = (ev) => {
        const i = Number(inp.dataset.i), k = inp.dataset.k, r = state.rows[i];
        if (k === 'dateMode') { r.value = inp.value === 'today' ? '@today' : ''; emit(); draw(); return; }
        r[k] = inp.value;
        if (k === 'key') { const ops = OPS[kindOf(fieldOf(r.key))]; if (!ops.some(x => x[0] === r.op)) r.op = ops[0][0]; r.value = ''; emit(); draw(); return; }
        if (k === 'op') { emit(); draw(); return; }
        emit();
      });
      const j = $('[data-j]', host); if (j) j.onchange = () => { state.joiner = j.value; emit(); };
      $$('[data-del]', host).forEach(b => b.onclick = () => { state.rows.splice(Number(b.dataset.del), 1); emit(); draw(); });
      $('[data-add]', host).onclick = () => { const f = fields[0] || { key: '', type: 'text' }; state.rows.push({ key: f.key, op: OPS[kindOf(f)][0][0], value: '' }); draw(); };
      $('[data-formula]', host).onclick = () => { o.expr = toExpr(state.rows, state.joiner); raw = true; draw(); };
    };
    draw();
  }

  FB.cond = { render, parse, toExpr, kindOf };
})();
