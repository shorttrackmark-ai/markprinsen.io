/* Ordovia expression engine (shared by browser and Cloudflare Worker)
 * A small, safe (no eval) spreadsheet-like language used everywhere:
 * form calculations, visibility rules, flow decisions and flow actions.
 *
 *   quantity * unit_price
 *   IF(total > 1000, "Finance", "Manager")
 *   days > 3 and type != "Sick"
 *   leave_request.days            (values from an earlier step in a process)
 *   initiator.department == "Sales"
 */
(function () {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;
  const FB = root.FB = root.FB || {};

  function ExprError(msg) { this.message = msg; }
  ExprError.prototype = Object.create(Error.prototype);
  ExprError.prototype.name = 'ExprError';

  // ---------- tokenizer ----------
  const OPS = ['==', '!=', '<>', '<=', '>=', '&&', '||', '<', '>', '=', '+', '-', '*', '/', '%', '^', '!', '(', ')', ',', '&'];
  const KEYWORDS = { and: '&&', or: '||', not: '!' };

  function tokenize(src) {
    const out = [];
    let i = 0;
    while (i < src.length) {
      const c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
        const m = /^[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?/.exec(src.slice(i));
        out.push({ t: 'num', v: parseFloat(m[0]) }); i += m[0].length; continue;
      }
      if (c === '"' || c === "'") {
        let j = i + 1, s = '';
        while (j < src.length && src[j] !== c) {
          if (src[j] === '\\' && j + 1 < src.length) { s += src[j + 1]; j += 2; } else { s += src[j++]; }
        }
        if (j >= src.length) throw new ExprError('Unclosed string');
        out.push({ t: 'str', v: s }); i = j + 1; continue;
      }
      if (c === '{') {
        const j = src.indexOf('}', i);
        if (j < 0) throw new ExprError('Unclosed {');
        out.push({ t: 'id', v: src.slice(i + 1, j).trim() }); i = j + 1; continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        const m = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(src.slice(i));
        const w = m[0], lw = w.toLowerCase();
        if (KEYWORDS[lw]) out.push({ t: 'op', v: KEYWORDS[lw] });
        else if (lw === 'true' || lw === 'false') out.push({ t: 'bool', v: lw === 'true' });
        else if (lw === 'null') out.push({ t: 'null' });
        else out.push({ t: 'id', v: w });
        i += w.length; continue;
      }
      const op = OPS.find(o => src.startsWith(o, i));
      if (!op) throw new ExprError('Unexpected character "' + c + '"');
      out.push({ t: 'op', v: op === '=' ? '==' : op === '<>' ? '!=' : op }); i += op.length;
    }
    out.push({ t: 'eof' });
    return out;
  }

  // ---------- Pratt parser ----------
  const BP = { '||': 1, '&&': 2, '==': 4, '!=': 4, '<': 4, '<=': 4, '>': 4, '>=': 4, '&': 5, '+': 6, '-': 6, '*': 7, '/': 7, '%': 7, '^': 8 };

  function parse(src) {
    const toks = tokenize(String(src));
    let p = 0;
    const peek = () => toks[p];
    const next = () => toks[p++];
    const expect = (v) => { const t = next(); if (t.t !== 'op' || t.v !== v) throw new ExprError('Expected "' + v + '"'); };

    function nud(t) {
      switch (t.t) {
        case 'num': case 'str': case 'bool': return { k: 'lit', v: t.v };
        case 'null': return { k: 'lit', v: null };
        case 'id':
          if (peek().t === 'op' && peek().v === '(') {
            next();
            const args = [];
            if (!(peek().t === 'op' && peek().v === ')')) {
              do { args.push(expr(0)); } while (peek().t === 'op' && peek().v === ',' && next());
            }
            expect(')');
            return { k: 'call', name: t.v.toUpperCase(), args };
          }
          return { k: 'id', name: t.v };
        case 'op':
          if (t.v === '(') { const e = expr(0); expect(')'); return e; }
          if (t.v === '-') return { k: 'neg', e: expr(9) };
          if (t.v === '+') return expr(9);
          if (t.v === '!') return { k: 'not', e: expr(3) };
      }
      throw new ExprError(t.t === 'eof' ? 'Unexpected end of expression' : 'Unexpected "' + (t.v ?? t.t) + '"');
    }

    function expr(rbp) {
      let left = nud(next());
      for (;;) {
        const t = peek();
        if (t.t !== 'op' || !(t.v in BP) || BP[t.v] <= rbp) break;
        next();
        const bp = BP[t.v];
        const right = expr(t.v === '^' ? bp - 1 : bp);
        left = { k: 'bin', op: t.v, a: left, b: right };
      }
      return left;
    }

    const ast = expr(0);
    if (peek().t !== 'eof') throw new ExprError('Unexpected "' + (peek().v ?? peek().t) + '"');
    return ast;
  }

  // ---------- helpers ----------
  const isNumeric = v => typeof v === 'number' || typeof v === 'boolean' ||
    (typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v));
  const num = v => v == null || v === '' ? 0 : typeof v === 'boolean' ? (v ? 1 : 0) : Number(v);
  const truthy = v => !(v == null || v === false || v === 0 || v === '' || (Array.isArray(v) && !v.length) || Number.isNaN(v));
  const str = v => v == null ? '' : Array.isArray(v) ? v.join(', ') : String(v);

  function toDate(v) {
    if (v == null || v === '') return null;
    const d = new Date(String(v).length === 10 ? v + 'T00:00:00' : String(v).replace(' ', 'T'));
    return isNaN(d) ? null : d;
  }
  const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

  function compare(a, b) {
    if (a == null || b == null) return a == null && b == null ? 0 : a == null ? -1 : 1;
    if (isNumeric(a) && isNumeric(b)) return num(a) - num(b);
    const x = str(a).toLowerCase(), y = str(b).toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }
  function equals(a, b) {
    if ((a == null || a === '') && (b == null || b === '')) return true;
    if (a == null || b == null) return false;
    if (Array.isArray(a)) return a.some(x => equals(x, b));
    return compare(a, b) === 0;
  }
  const list = args => args.flat().filter(v => v != null && v !== '');

  const FUNCS = {
    AND: a => a.every(truthy), OR: a => a.some(truthy), NOT: a => !truthy(a[0]),
    SUM: a => list(a).reduce((s, v) => s + num(v), 0),
    AVG: a => { const l = list(a); return l.length ? l.reduce((s, v) => s + num(v), 0) / l.length : 0; },
    MIN: a => Math.min(...list(a).map(num)), MAX: a => Math.max(...list(a).map(num)),
    COUNT: a => list(a).length,
    ROUND: a => { const f = Math.pow(10, num(a[1])); return Math.round(num(a[0]) * f) / f; },
    FLOOR: a => Math.floor(num(a[0])), CEIL: a => Math.ceil(num(a[0])), ABS: a => Math.abs(num(a[0])),
    NUMBER: a => num(a[0]), TEXT: a => str(a[0]),
    LEN: a => str(a[0]).length, UPPER: a => str(a[0]).toUpperCase(), LOWER: a => str(a[0]).toLowerCase(),
    TRIM: a => str(a[0]).trim(), CONCAT: a => a.map(str).join(''),
    CONTAINS: a => Array.isArray(a[0]) ? a[0].some(x => equals(x, a[1])) : str(a[0]).toLowerCase().includes(str(a[1]).toLowerCase()),
    ISEMPTY: a => a[0] == null || a[0] === '' || (Array.isArray(a[0]) && !a[0].length),
    COALESCE: a => a.find(v => v != null && v !== '') ?? null,
    TODAY: () => iso(new Date()),
    NOW: () => new Date().toISOString().slice(0, 19).replace('T', ' '),
    YEAR: a => { const d = toDate(a[0]); return d ? d.getFullYear() : null; },
    MONTH: a => { const d = toDate(a[0]); return d ? d.getMonth() + 1 : null; },
    WEEKDAY: a => { const d = toDate(a[0]); return d ? ((d.getDay() + 6) % 7) + 1 : null; },
    ADDDAYS: a => { const d = toDate(a[0]); if (!d) return null; d.setDate(d.getDate() + num(a[1])); return iso(d); },
    DAYS: a => { const s = toDate(a[0]), e = toDate(a[1]); return s && e ? Math.round((e - s) / 86400000) : null; },
    WORKDAYS: a => {
      const s = toDate(a[0]), e = toDate(a[1]);
      if (!s || !e || e < s) return s && e ? 0 : null;
      let n = 0; const d = new Date(s);
      for (let guard = 0; d <= e && guard < 3700; guard++) { const w = d.getDay(); if (w && w !== 6) n++; d.setDate(d.getDate() + 1); }
      return n;
    },
  };

  function lookup(ctx, name) {
    if (ctx == null) return null;
    if (Object.prototype.hasOwnProperty.call(ctx, name)) return ctx[name];
    const parts = name.split('.');
    let v = ctx;
    for (const part of parts) { if (v == null || typeof v !== 'object') return null; v = v[part]; }
    return v === undefined ? null : v;
  }

  function ev(n, ctx) {
    switch (n.k) {
      case 'lit': return n.v;
      case 'id': return lookup(ctx, n.name);
      case 'neg': return -num(ev(n.e, ctx));
      case 'not': return !truthy(ev(n.e, ctx));
      case 'call': {
        if (n.name === 'IF') return truthy(ev(n.args[0], ctx)) ? (n.args[1] ? ev(n.args[1], ctx) : true) : (n.args[2] ? ev(n.args[2], ctx) : null);
        const f = FUNCS[n.name];
        if (!f) throw new ExprError('Unknown function ' + n.name + '()');
        return f(n.args.map(a => ev(a, ctx)));
      }
      case 'bin': {
        if (n.op === '&&') return truthy(ev(n.a, ctx)) && truthy(ev(n.b, ctx));
        if (n.op === '||') return truthy(ev(n.a, ctx)) || truthy(ev(n.b, ctx));
        const a = ev(n.a, ctx), b = ev(n.b, ctx);
        switch (n.op) {
          case '==': return equals(a, b);
          case '!=': return !equals(a, b);
          case '<': return compare(a, b) < 0;
          case '<=': return compare(a, b) <= 0;
          case '>': return compare(a, b) > 0;
          case '>=': return compare(a, b) >= 0;
          case '&': return str(a) + str(b);
          case '+':
            if ((isNumeric(a) || a == null) && (isNumeric(b) || b == null)) return num(a) + num(b);
            return str(a) + str(b);
          case '-': return num(a) - num(b);
          case '*': return num(a) * num(b);
          case '/': return num(b) === 0 ? null : num(a) / num(b);
          case '%': return num(b) === 0 ? null : num(a) % num(b);
          case '^': return Math.pow(num(a), num(b));
        }
      }
    }
    throw new ExprError('Bad expression');
  }

  const cache = new Map();
  function compile(src) {
    if (!cache.has(src)) cache.set(src, parse(src));
    return cache.get(src);
  }

  function identifiers(src) {
    const ids = new Set();
    (function walk(n) {
      if (!n) return;
      if (n.k === 'id') ids.add(n.name);
      if (n.e) walk(n.e); if (n.a) walk(n.a); if (n.b) walk(n.b);
      if (n.args) n.args.forEach(walk);
    })(compile(src));
    return [...ids];
  }

  FB.expr = {
    ExprError,
    functions: Object.keys(FUNCS).concat('IF').sort(),
    /** Evaluate; throws on syntax/function errors. */
    evaluate(src, ctx) { return ev(compile(src), ctx || {}); },
    /** Evaluate, returning fallback on any error (for live UI). */
    safe(src, ctx, fallback = null) {
      if (src == null || String(src).trim() === '') return fallback;
      try { const v = ev(compile(src), ctx || {}); return Number.isNaN(v) ? fallback : v; } catch (e) { return fallback; }
    },
    /** Return an error message, or null when the expression is valid. */
    check(src) { try { compile(src); return null; } catch (e) { return e.message; } },
    truthy,
    identifiers,
  };
})();
