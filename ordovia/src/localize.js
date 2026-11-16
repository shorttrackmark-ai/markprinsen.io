// Dutch versions of the ready-made templates. A template is data (forms, processes, formulas); it is translated before it is stored,
// so a Dutch company gets Dutch forms, steps and instructions of its own to edit.
// Only text that people read is translated. Ids, field keys and types are never touched. Text inside formulas ("Approve") is translated
// with the same dictionary as the option lists it is compared with, so rules keep working.
import { NL } from './nl.gen.js';

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const DICT = new Map(), PATS = [];
for (const [k, v] of Object.entries(NL)) {
  const key = norm(k);
  if (!key.includes('{}')) { DICT.set(key, v); continue; }
  const parts = key.split('{}'); let n = 0;
  PATS.push({ re: new RegExp('^' + parts.map(esc).join('(.+?)') + '$'), to: v.split('{}').reduce((a, piece, i) => a + (i ? '$' + (++n) : '') + piece, ''), literal: parts.join('').length });
}
PATS.sort((a, b) => b.literal - a.literal);

/** The Dutch text for an English phrase; the phrase itself when there is no translation. */
export function trText(s) {
  if (typeof s !== 'string') return s;
  const lead = /^\s*/.exec(s)[0], tail = /\s*$/.exec(s)[0], core = norm(s);
  if (!core) return s;
  let out = DICT.get(core);
  if (out === undefined) {
    for (const p of PATS) {
      const m = p.re.exec(core); if (!m) continue;
      out = p.to.replace(/\$(\d)/g, (_, i) => { const g = m[Number(i)], d = DICT.get(norm(g)); return d === undefined ? g : d; });
      break;
    }
  }
  return out === undefined ? s : lead + out + tail;
}
export const hasText = (s) => DICT.has(norm(s)) || PATS.some(p => p.re.test(norm(s)));

/** In a formula only the quoted text is translated: IF(risk >= 15, "High", "Low") -> IF(risk >= 15, "Hoog", "Laag"). */
export function trFormula(f) {
  if (typeof f !== 'string') return f;
  return f.replace(/"((?:[^"\\]|\\.)*)"/g, (m, inner) => '"' + trText(inner).replace(/"/g, '\\"') + '"');
}

const TEXT = new Set(['name', 'description', 'summary', 'label', 'help', 'placeholder', 'checkLabel', 'validateMsg', 'instructions', 'purpose', 'owner_role', 'records', 'scope', 'area', 'pack', 'form', 'request_form', 'works_on', 'note', 'message']);
const FORMULA = new Set(['formula', 'default', 'visibleIf', 'validate', 'when', 'title', 'rule', 'condition']);
const TEXT_LISTS = new Set(['options', 'tags', 'same_as_initiator']);
const FORMULA_LISTS = new Set(['set']);

/** A copy of a template (or any bundle) in Dutch. */
export function localize(node) {
  if (Array.isArray(node)) return node.map(localize);
  if (!node || typeof node !== 'object') return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === 'string') out[k] = TEXT.has(k) ? trText(v) : FORMULA.has(k) ? trFormula(v) : v;
    else if (Array.isArray(v) && v.every(x => typeof x === 'string')) out[k] = TEXT_LISTS.has(k) ? v.map(trText) : FORMULA_LISTS.has(k) ? v.map(trFormula) : v;
    else out[k] = localize(v);
  }
  return out;
}

/** Every phrase of a template that a person reads (used to find what still lacks a translation). */
export function phrases(node, into = new Set()) {
  if (Array.isArray(node)) { node.forEach(x => phrases(x, into)); return into; }
  if (!node || typeof node !== 'object') return into;
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === 'string') { if (TEXT.has(k)) into.add(v); else if (FORMULA.has(k)) for (const m of v.matchAll(/"((?:[^"\\]|\\.)*)"/g)) into.add(m[1]); }
    else if (Array.isArray(v) && v.every(x => typeof x === 'string')) { if (TEXT_LISTS.has(k)) v.forEach(x => into.add(x)); else if (FORMULA_LISTS.has(k)) v.forEach(f => { for (const m of f.matchAll(/"((?:[^"\\]|\\.)*)"/g)) into.add(m[1]); }); }
    else phrases(v, into);
  }
  return into;
}
