/* Help per screen: the "?" in the top bar (or the ? key) explains the screen you are on, in plain words. */
(function () {
  'use strict';
  const FB = window.FB;
  const { esc, $, modal } = FB.ui;

  // [route pattern, title, what it is, what you can do]
  const HELP = [
    [/^\/$/, 'My tasks', 'Everything that is waiting for you, and the processes you can start.',
      ['Open a task, fill in the form and press “Complete task”: the process continues by itself.', 'Press a process under “Start a process” to start a new case.', 'Going away? Press “I’m away…” and choose a deputy who covers your tasks.']],
    [/^\/processes$/, 'Cases', 'Every time someone starts a process, a case is created. Here you can follow all of them.',
      ['Search or sort the list; open a case to see its timeline.', 'Press “Export CSV” to take the list to Excel.']],
    [/^\/processes\/\d+/, 'A case', 'The whole story of one case: which steps are done, by whom, and what was filled in.',
      ['“Print or save as PDF” gives a case report you can hand to an auditor.', 'A step that is waiting shows who has to do it.']],
    [/^\/task\//, 'A task', 'One step of a process: a form for you to fill in.',
      ['Read the work instruction at the top, then fill in the form. Fields with * are required.', 'Answers from earlier steps are already filled in: you only enter things once.', 'Documents and links at the right belong to this step.']],
    [/^\/handbook\/\d+/, 'A process in the handbook', 'The description of a process: purpose, owner, the diagram and the work instructions.',
      ['“Mark as reviewed” confirms that the process is still right.', '“Performance” shows where cases wait, based on all cases so far.']],
    [/^\/handbook/, 'Handbook', 'How we work: every active process with its purpose, owner and steps. Always the same as what actually runs.',
      ['Open a process to see its diagram and instructions.', 'Processes that are due for review are marked.']],
    [/^\/(data|objects)/, 'Data', 'Everything people entered, in one place: registers (like suppliers or orders) and objects (like machines, each with its own page).',
      ['Open a register to search, sort and export its records.', 'An object has its own page with its details, links and the processes run on it.']],
    [/^\/documents/, 'Documents', 'The company library: norms, policies, work instructions, photos. Every document has an owner, versions and a review date.',
      ['“Upload document” adds a file; “Upload new version” keeps the old one in the history.', 'Link a document (with the chapter) to the process step where it matters.']],
    [/^\/dashboards/, 'Dashboards', 'Numbers and charts about your processes and data.',
      ['Open a dashboard to see it; administrators can edit widgets.', 'Dashboards are about processes, never about people.']],
    [/^\/(areas|area\/)/, 'Areas', 'Everything is grouped by department or domain. Each area has an owner and offers its processes, forms and documents to the rest of the company.',
      ['Open an area to see everything that belongs to it.']],
    [/^\/admin\/flows\/\d+/, 'The process designer', 'Draw a process: steps, who does them, and the arrows between them.',
      ['Add a step with the buttons on top, then drag from the ● of one step to the next to connect them.', 'Click a step to choose its form and who does it. Click an arrow after a decision to set when it is taken.', 'The check at the bottom tells you if something cannot work. Press “Save” when you are done.', 'Running processes keep the version they started with, so you can change safely.']],
    [/^\/admin\/flows/, 'Flows', 'The list of process designs.',
      ['“+ New flow” starts a new design; “Describe with AI” or a template gives you a head start.', 'A flow starts as a draft; set it to “active” when it is right.']],
    [/^\/admin\/forms\/\d+/, 'The form builder', 'Build the form: fields on the left, a live preview on the right.',
      ['Add fields, choose their type and whether they are required.', 'A field can check its input (length, dates, patterns) and show only when a rule is true.', 'Calculated fields and checks across fields use simple rules; you rarely need to type a formula.']],
    [/^\/admin\/forms/, 'Forms', 'The forms used in your processes and registers.',
      ['“This is a class of objects” turns a form into things like machines or suppliers with their own pages.']],
    [/^\/admin\/templates|^\/admin\/ai/, 'Templates', 'Start from a process that works instead of a blank page.',
      ['Choose a template, look at the preview and add it: it arrives as a draft you can adapt.', '“Describe with AI”: describe your process in words, copy the text to an AI you already use, paste its answer back.']],
    [/^\/admin\/people/, 'People & tags', 'The people in your company and the tags and attributes that decide who gets which task.',
      ['“+ Person” without a password sends an invitation by e-mail; they choose their own password.', 'Give people tags (department, function) so tasks reach the right person.']],
    [/^\/admin\/health/, 'Health', 'What needs attention in this workspace, checked just now.',
      ['Fix the red items first: they mean something cannot work as intended.']],
    [/^\/admin\/billing/, 'Plan & billing', 'Your subscription, the plans and this month’s usage.',
      ['Choose a plan to continue after the trial. “Manage payment details & invoices” opens the secure payment page.']],
    [/^\/admin\/settings/, 'Settings', 'The workspace: name, language, colour, notifications, and your data.',
      ['Download everything (ZIP) at any time. Back-ups are made every night; you can restore one here.', 'Under “Leave Ordovia” you can delete the company for good.']],
    [/^\/admin\/api/, 'API & web forms', 'Connect other systems and offer public request forms.',
      ['An API token lets a system start and follow processes as a person you choose.', 'A public web form lets anyone with the link send a request without signing in.']],
    [/^\/admin\/activity/, 'Activity', 'Who changed what, and when. Newest first.', []],
    [/^\/admin\/sql/, 'SQL console', 'For administrators who know SQL: read and change data directly. Passwords are never shown.', []],
    [/^\/me/, 'What Ordovia knows about you', 'Everything that is recorded about you, why, and how to download it. Also your account settings.',
      ['Change your password, e-mail address or language here.']],
  ];
  const GENERAL = ['Use the menu on the left to move around.', 'Press / to search everything.', 'Stuck? Ask your administrator, or look at the example (“Try the example” on the sign-in page) to see how things work.'];

  FB.showHelp = () => {
    const path = (location.hash || '#/').slice(1).split('?')[0] || '/';
    const h = HELP.find(x => x[0].test(path));
    const list = (a) => (a.length ? `<ul class="help-list">${a.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : '');
    modal('Help', `<h3 style="margin-top:0">${esc(h ? h[1] : 'Ordovia')}</h3>${h ? `<p>${esc(h[2])}</p>${list(h[3])}` : ''}<h4>In general</h4>${list(GENERAL)}`);
  };
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('#helpBtn')) FB.showHelp(); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target; if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (document.body.classList.contains('logged-out')) return;
    e.preventDefault(); FB.showHelp();
  });
  FB.helpTexts = HELP; FB.helpGeneral = GENERAL;
})();
