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

## Folders, chapters and Microsoft (built)
- Documents have an optional `folder` (text path, two levels: "Quality / ISO 9001"). A folder filter sits on the library page.
- A step links a document *and* the part that matters: `node.docSections = {docId: "Chapter 4.2"}`; shown at the task, in the handbook and on the document page.
- `GET /api/v1/openapi.json` (public, Swagger 2.0) imports as a Power Automate / Logic Apps custom connector. The API page explains the steps.
- Notification webhook format `teams` posts an Adaptive Card for a Teams workflow webhook (setting `notify_format`).
- Not built yet: AI steps (extract, classify, draft) and Microsoft sign-in.

## One address (built)
The example no longer has its own Worker. `ordovia` has a second D1 (`DB_DEMO`) and R2 bucket (`FILES_DEMO`); "Try the example" sets the cookie `ordovia_mode=example`, and from then on that browser's requests use the example database and its own session cookie. "Exit example" clears it. Hourly cron resets the example at 03:xx UTC. `npm run deploy` migrates both databases. The old `ordovia-demo` Worker is obsolete.

## Classes and objects (stage 1, built)
- **Class** = a form with `is_class = 1` (tick "This is a class of objects" in the form builder). Its records are **objects**: each has a page under Objects (attributes, processes that worked on it, processes you can start on it).
- **Subject**: the start step of a flow can say "Works on: <class>" (`node.subjectForm`). Whoever starts it chooses the object; the run stores `subject_form_id` / `subject_id`, and formulas read it as `subject.<attribute>` (also under the class slug). A Record step with mode update and record id `subject.id` writes results back to the object.
- **Person attributes** (`persons.attrs`, field definitions in settings `person_fields`): job title, employee number... Formulas read `initiator.job_title`; a task can be assigned to "everyone whose attribute is ..." (`assignee {type:'attr', key, value, label}`).
- Example: Machine class + "Machine calibration" process (metrologist by job title; result updates the machine).
- Not yet: file/photo attributes on persons, time-driven starts ("calibration due in 30 days"), a sub-process step, class library packs.

## Links (built)
One mechanism to connect anything to anything: table `links` (a → b, each end = type document | object | flow, plus an optional step of a flow), `note` (the chapter, page or remark that matters) and `show_if` (a formula over a run's data: at a step the link only shows when it is true). Both ends show a link: a document lists where it is used, a machine lists its photo and procedure, a step lists what it needs. A photo is a document of kind `photo` (shown as a picture). Panel: `FB.org.links` (public/js/links.js) on documents, objects, processes (handbook) and steps (designer); API `/api/links`, `/api/link-search`. Who may link: administrators and the owner of a document at either end. Deleting a document, object or process removes its links. Older step documents (`node.docIds`) still show, read-only, as "set in the flow".

## Usability pass (2026-11-12)
Home shows the person's tasks first (relative due dates), then starting a process (searchable above six), then recent cases; a started process is a **case** (nav "Cases", page /processes). A process without a request form asks before starting (no empty cases by accident). A task says who it is for ("you"), what happens next (`afterwards`, from the flow graph), and the case it belongs to. New workspaces start clean (example data only when ticked) and show a getting-started card to admins until a first process exists. Lists are sortable registers.

## Describe with AI (built)
No AI service and no key: Build › Describe with AI. The user describes a process; the app writes a prompt (format with an example, rules, the formula language, the workspace's areas, tags, person attributes and existing forms); the user pastes it into any AI (Copilot, ChatGPT, Claude) and pastes the JSON answer back. `src/bundle.js` extracts the JSON (fences, smart quotes, trailing commas), resolves every name against the workspace, checks every formula, refuses webhook steps, and returns a plan; `/api/admin/ai/preview` summarises it (or lists plain-language problems, with a "copy a message for the AI" button), `/api/admin/ai/apply` creates missing tags, forms (draft) and processes (draft, auto-layout). 154 smoke checks include an AI-built leave process that really runs end to end.

## Governance: everything has a home (built)
New forms start as drafts. Forms, processes and documents cannot become active without an area (409 "Choose an area first…"); documents need an area from the start. Health now also finds: person-attribute rules nobody satisfies, documents linked to nothing, classes without objects or processes, processes unused for six months (archive?), and near-duplicate names of processes, forms and documents.

## Templates (built)
Build › Templates: 11 ready-made processes in five packs (Health & safety: incident & corrective action, safety inspection, risk assessment, toolbox talk; People: leave, onboarding; Purchasing & finance: purchase request; Quality & equipment: machine calibration (with a Machine class), supplier approval; IT: access request). `src/templates.js`; each template is a bundle (the same format as "Describe with AI"), so it goes through the same checks and `applyPlan`: added as drafts in the chosen area, existing forms reused, missing tags created (Health reminds that nobody has them yet). test/templates.test.js verifies every template is valid, fully reachable and starts without getting stuck.

## Keeping the process moving (built)
- **Absence cover:** "I'm away…" on My tasks (and Absence in the people dialog): until a date, the chosen deputy receives the tasks that would go to the absent person (`D.covering`, migration 0008).
- **Escalation:** the hourly job flags an overdue task once and also hands it to the process owner (`tasks.escalated_at`), who sees it marked "overdue – handed to you", may complete or reassign it; the timeline records it. Process owners can also open the cases of their processes.
- **Reassign:** owner or administrator, to any active person, recorded in the timeline. `POST /api/admin/overdue-check` runs the same check on demand.

## Case report and CSV export (built)
Cases › a case › Report: a print-ready record (summary with process version, route diagram, steps with who/when, the information entered per step, the full timeline) for auditors and files; print or save as PDF from the browser. Every register has "Export CSV" (what is on screen).

## External links: the single source stays where it lives (built)
A link can point outside Ordovia (link type `url`, migration 0009; https only): a SharePoint or OneDrive file, a Teams channel, a Google Drive file, any page. It is labelled by where it lives, shows with a name and the part that matters, can carry a condition, and appears on objects, processes and steps like any other link. Ordovia only records where things are; nothing is copied and nothing is fetched.

## Process insight (built)
Handbook › a process › Performance (process owner or administrator; `GET /api/flows/:id/insight`): cases, typical time to finish (median, 9 in 10), where cases wait (average wait per step, slowest first, open and late counts), how cases end (outcomes, rejected highlighted), cases per month, share of late steps. Deliberately per process, not general BI: it is what only Ordovia knows.

## Transparency: what Ordovia knows about me (built)
Click your name in the top bar: `/me` (`GET /api/me/data`) lists everything linked to you: profile, tags and attributes, tasks done and waiting, cases started, information entered (with content in the download), files, documents and processes you own, sign-ins, API tokens, and changes made as a builder; with the reason for each and the promise that Ordovia records what is *done* in a process, nothing else (no reading, no typing speed, no activity outside processes, no scoring or ranking). One-click JSON download. Only your own data is included.

Core principle: a form is both the process step and the information (completing the step is entering the data), so data entry is never extra work and the data is the shared single source.

## Enter once (built)
A task's form takes over what an earlier step of the same case already collected: fields with the same key and type, for simple types (text, number, date, e-mail, choice, person, record). They show "Taken over from “<step>”. Change it if it is not right." Yes/no, radio and long-text answers stay empty by default (a second approval must not inherit the first decision). Per field the builder can choose Automatic, Always or Never ("Take over from earlier steps"). Later answers win over earlier ones; a take-over wins over a default value.

## Corrections as an ordinary route (built)
No messaging: if a reviewer must send work back, the process has a "Needs correction" branch (reason required) that loops to a task for the requester (the same form, all earlier answers filled in) and back to the review. The task page says "This step came back (round N)". Performance counts, per step and never per person, how often a step was done again and how many cases came back ("Done again"); a step that shows it often points to a form or instructions to improve. The Purchase request template and the AI prompt use the pattern.

## Milestone notifications and form rules (built)
- **End step notifications:** on an End step of a process, "Send a notification when a case ends here" posts `{event: "case.ended", text, process, outcome, case, link}` (plain JSON or a Teams card) to an https address, e.g. a Power Automate flow ("When an HTTP request is received") or a Teams workflow; the case timeline records it. Together with the Webhook step this lets a process *do things in Microsoft 365* through Power Automate, with nothing installed. A direct Microsoft Graph step (send mail, create items) is possible later but needs an Entra app registration, admin consent and a stored secret: ask first.
- **Standard form rules in the builder:** mandatory, min/max (numbers), whole numbers, min/max length, earliest/latest date (formulas such as TODAY()), format, pattern with message, placeholder, plus the free formula rule; checked on the screen and again on the server.

## Quieter navigation (built)
Menu for everyone: My tasks, Cases, Handbook, Data, Documents, Dashboards, Areas. Admin: Build (Flows, Forms, Templates, People & tags), Control (Health, Settings, and "More": API & web forms, Activity, SQL console). Objects live under Data (a class opens its objects; "Table view" shows the plain register); Describe with AI is reached from Flows and Templates. The Data page shows registers and objects by default; forms that exist only as steps of a process (kind "step", worked out from the flows: used as a task or request form and not as a record target or class) are one click away under "Forms of processes".

## First-time builder fixes (iteration 12)
New process / form / dashboard open a proper dialog (name, and the area it belongs to) instead of a browser prompt. In the designer a step's form can be created on the spot ("+ New form for this step": named after the step, in the process's area, as a draft) and opened with "Edit this form" (the process is saved first); archived forms are no longer offered.

## Rule builder (built)
Conditions are built, not typed: on a decision arrow ("When is this arrow taken?") and on a form field ("Show this field only when"): choose a field (by its label), "is / is not / contains / is greater than / is at least / is before / is ticked / is filled in…" depending on its type, and a value (a dropdown for choices, a date or "today" for dates); parts are joined with "and also" or "or". It reads and writes the ordinary formula (`days > 3 and type != "Sick"`), so existing rules open in it; rules it cannot read (functions, mixed and/or) show as a formula to edit, and "Edit as formula" is always available. `public/js/cond.js`, test/cond.test.js.

## Process checks (hardened)
A process cannot go live (and Health reports it as an error) when: it lacks exactly one Start or any End; a step has no way out or cannot be reached; steps are connected only to each other and cut off from Start; from some step no path leads to an End (a loop without an exit); a decision has no "otherwise" arrow, has several arrows without a rule, or a lone arrow carries a rule (the case would get stuck); plus the earlier checks (forms exist, rules and formulas valid, https addresses, public web form limits). Messages are plain sentences with the step name. test/process-checks.test.js; all templates pass.
