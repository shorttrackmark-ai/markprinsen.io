// A company's data as a snapshot (for nightly backups and for restoring), and as a full export to take away (JSON + CSV per register + the files).
import { all, first, run, now, formViewSQL, parse } from './lib.js';
import { zipStream } from './zip.js';

const NOT_DATA = /^(sqlite_|_cf_|_ord_|d1_migrations)/;
const NOT_RESTORED = new Set(['sessions', 'account_tokens']);                 // people sign in again after a restore
const NEVER_EXPORTED = { persons: ['pw_hash'], api_tokens: ['token_hash'], sessions: null, account_tokens: null };   // nothing secret leaves in an export

export async function tableNames(db) {
  return (await all(db, "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")).map(t => t.name).filter(n => !NOT_DATA.test(n));
}
async function dump(db, name, hide = []) {
  const raw = await db.prepare(`SELECT * FROM "${name}"`).raw({ columnNames: true });
  const [columns, ...rows] = raw.length ? raw : [[]];
  const keep = columns.map((c, i) => (hide.includes(c) ? -1 : i)).filter(i => i >= 0);
  return { columns: keep.map(i => columns[i]), rows: rows.map(r => keep.map(i => r[i])) };
}

/** Everything needed to put the company back exactly as it is now (includes password fingerprints: kept private, never offered for download). */
export async function snapshot(db) {
  const tables = {};
  for (const n of await tableNames(db)) if (!NOT_RESTORED.has(n)) tables[n] = await dump(db, n);
  return { format: 1, at: now(), tables };
}

/** Put a snapshot back: all rows are replaced, the views of the forms are built again. Runs through the company's own object in one transaction. */
export async function restoreSnapshot(stub, db, snap) {
  if (!snap || snap.format !== 1 || !snap.tables) throw new Error('This is not an Ordovia backup');
  const have = await tableNames(db);
  const list = [];
  for (const [name, t] of Object.entries(snap.tables)) {
    if (!have.includes(name) || NOT_RESTORED.has(name)) continue;
    const now_ = (await all(db, `PRAGMA table_info("${name}")`)).map(c => c.name);
    const idx = t.columns.map((c, i) => (now_.includes(c) ? i : -1)).filter(i => i >= 0);   // (a column that no longer exists is skipped)
    list.push({ name, columns: idx.map(i => t.columns[i]), rows: t.rows.map(r => idx.map(i => r[i])) });
  }
  const views = (await all(db, "SELECT name FROM sqlite_master WHERE type = 'view' AND name LIKE 'form\\_%' ESCAPE '\\'")).map(v => v.name);
  await stub.replaceAll(have, list, views);
  const forms = await all(db, 'SELECT id, slug, fields FROM forms');
  if (forms.length) await db.batch(forms.flatMap(f => formViewSQL({ id: f.id, slug: f.slug, fields: parse(f.fields, []) }).map(s => db.prepare(s))));
  return { tables: list.length, rows: list.reduce((n, t) => n + t.rows.length, 0) };
}

// ---------------------------------------------------------------- the export to take away
const csvCell = (v, sep) => { if (v == null) return ''; const s = typeof v === 'object' ? JSON.stringify(v) : String(v); return /["\r\n]/.test(s) || s.includes(sep) ? '"' + s.replace(/"/g, '""') + '"' : s; };
export const toCsv = (columns, rows, sep) => '﻿' + [columns, ...rows].map(r => r.map(v => csvCell(v, sep)).join(sep)).join('\r\n') + '\r\n';
const safe = (s) => String(s).replace(/[^A-Za-z0-9._ -]+/g, '_').slice(0, 80) || 'file';

const README = {
  nl: (company, at) => `Export van ${company}\nGemaakt op ${at}\n\nWat zit erin:\n- data.json: alle gegevens (instellingen, mensen zonder wachtwoorden, afdelingen, formulieren, processen, zaken, taken, documenten, koppelingen, logboek).\n- registers/: elk register of object als CSV-bestand (opent in Excel).\n- bestanden/: alle geüploade bestanden en documenten, met bestanden.csv als overzicht.\n\nWachtwoorden en API-tokens zitten er om veiligheidsredenen niet in.\n`,
  en: (company, at) => `Export of ${company}\nCreated ${at}\n\nWhat is inside:\n- data.json: all data (settings, people without passwords, areas, forms, processes, cases, tasks, documents, links, log).\n- registers/: every register or object as a CSV file (opens in Excel).\n- files/: every uploaded file and document, with files.csv as an index.\n\nPasswords and API tokens are not included, for safety.\n`,
};

/** Writes the whole export into a ZIP stream (one file in memory at a time). */
export async function writeExport(zip, { db, files, company, lang }) {
  const at = now(), sep = lang === 'en' ? ',' : ';', d = lang === 'en' ? 'files' : 'bestanden', r = lang === 'en' ? 'registers' : 'registers';
  await zip.add('README.txt', (README[lang] || README.nl)(company, at));
  const out = { exported_at: at, company, tables: {} };
  for (const n of await tableNames(db)) {
    const hide = NEVER_EXPORTED[n];
    if (hide === null) continue;
    const t = await dump(db, n, hide || []);
    out.tables[n] = t.rows.map(row => Object.fromEntries(t.columns.map((c, i) => [c, row[i]])));
  }
  await zip.add('data.json', JSON.stringify(out, null, 1));
  const forms = await all(db, "SELECT id, name, slug FROM forms WHERE status != 'archived' OR 1 = 1");
  for (const f of forms) {
    try {
      const raw = await db.prepare(`SELECT * FROM "form_${f.slug}"`).raw({ columnNames: true });
      const [columns, ...rows] = raw.length ? raw : [[]];
      if (columns.length) await zip.add(`${r}/${safe(f.slug)}.csv`, toCsv(columns, rows, sep));
    } catch { /* a form without a view yet */ }
  }
  const fl = await all(db, 'SELECT f.id, f.key, f.name, f.mime, f.size, d.name AS document FROM files f LEFT JOIN document_versions v ON v.file_id = f.id LEFT JOIN documents d ON d.id = v.document_id');
  const index = [];
  for (const f of fl) {
    const obj = files ? await files.get(f.key) : null;
    if (!obj) { index.push([f.id, f.name, f.document || '', f.size, 'ontbreekt / missing']); continue; }
    const name = `${d}/${f.id}-${safe(f.name)}`;
    await zip.add(name, new Uint8Array(await obj.arrayBuffer()));
    index.push([f.id, f.name, f.document || '', f.size, name]);
  }
  await zip.add(`${d}/${lang === 'en' ? 'files' : 'bestanden'}.csv`, toCsv(['id', 'name', 'document', 'size', 'path'], index, sep));
  await zip.finish();
}
export function exportZip(ctx) {
  const zip = zipStream();
  const job = writeExport(zip, ctx).catch(e => { console.error('export failed', e); return zip.abort(e); });
  return { readable: zip.readable, job };
}
void first; void run;
