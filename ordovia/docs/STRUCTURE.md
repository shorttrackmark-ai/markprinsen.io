# How Ordovia keeps a growing company tidy

Ordovia is **the interface between departments and systems**: a process is a service with a defined input (its request form),
a status you can follow, and a result. It does not replace e-mail or chat; it replaces the "can you send me…" between them.

## Three layers

1. **Organisation** – *Areas* (a department or domain, with an owner), *people*, *tags*.
2. **Definitions** (what you design). Every definition has: **area, owner, status (draft → active → archived), review date, version history, audit trail.**
   - **Service** (a *flow*): input = request form, steps, outputs, due times. Only *active* services can be started.
   - **Form** – three intended kinds (not built yet, see *Decisions*): **register** (long-lived master data such as suppliers, shown under Data),
     **request** (the input of exactly one service) and **step** (used in a task; shared ones like "Approval" allowed).
   - **Document** (not built yet): policies, work instructions, templates, attached to an area / service / step, with owner and review date.
   - **Dashboard.**
3. **Runtime** (what happens): *run*, *task*, *record*, *event*. A form is either submitted or gone – no half-filled records.

Integration: *API tokens* (act as a chosen person), *public web forms* (a service's request form, no login), *webhook steps*, *callbacks*.

## Rules of the road

- One owner, one area per definition. Unowned or area-less things show up in **Control › Health**.
- Delete only what is archived. Archive first; restore any time.
- An *active* service can never have open issues: saving it with issues makes it a draft again.
- Changes are logged (**Control › Activity**); a flow's earlier versions can be looked at and restored.
- Review dates: a service not reviewed within its cycle is flagged in Health and in the handbook.
- Duplicate instead of copy-pasting (not built yet).

## Decisions pending

- Form *kinds* (register / request / step) and hiding request/step forms inside their service.
- Documents as a first-class thing (text first, files on R2 later).
- Retention per class (archive finished runs after N months).

## Files and documents (built)

- **Files** live in R2 (`FILES` binding), their register in D1 (`files`). 10 MB per file; programs, web pages and scripts are refused; served with `nosniff` and a sandbox policy. A file is private to its uploader until it becomes part of a document or a saved record; loose uploads are removed after a day.
- **Documents** (norms, policies, procedures, work instructions, templates): area, owner, status, review cycle, version history (each upload is a version and counts as a review). Linked to process steps (`Documents at this step`) so they appear in the task and in the handbook. Missing owner/area/review and broken step links show up in Health.
- **File fields** in forms: the file is stored with the record and opens from the data view and the "earlier in this process" panel. Not available in public web forms.
- **Formats**: a text field can be an IBAN, Dutch postcode, phone number, web address or code, or follow your own pattern; values are checked on the server and written in one standard spelling. Number fields can require whole numbers.
- Health also warns when a formula uses a name that no earlier step provides (typo detector with "did you mean").
