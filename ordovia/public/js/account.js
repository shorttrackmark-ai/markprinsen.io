/* Account links (invitation, password reset, new e-mail address) and "Your account" (change password / e-mail). */
(function () {
  'use strict';
  const FB = window.FB;
  const { esc, $, toast, modal } = FB.ui;
  const api = FB.api;

  const box = (main, html) => { main.innerHTML = `<div class="login-wrap"><div class="card login">${html}</div></div>`; };

  FB.route('/account/:token', async (main, { token }) => {
    let d;
    try { d = await api.get('/public/account/' + encodeURIComponent(token)); }
    catch (e) { box(main, `<div class="brand big"><span class="logo-mark">◆</span> Ordovia</div><h2>This link does not work</h2><p class="muted">${esc(e.message)}</p><p><a href="#/">Go to sign-in</a> – on the sign-in page you can choose “Forgot your password?”.</p>`); return true; }
    if (d.kind === 'email') {
      box(main, `<div class="brand big"><span class="logo-mark">◆</span> ${esc(d.company)}</div><h2>Confirm your new e-mail address</h2><p class="muted">From now on you sign in with <b>${esc(d.email)}</b>.</p><button class="btn primary block" id="ok">Confirm</button>`);
      $('#ok', main).onclick = async () => {
        try { await api.post('/public/account/' + encodeURIComponent(token), {}); box(main, `<div class="brand big"><span class="logo-mark">◆</span> ${esc(d.company)}</div><h2>Done</h2><p class="muted">Your address is now <b>${esc(d.email)}</b>.</p><p><a href="#/">Continue</a></p>`); }
        catch (e) { toast(e.message, 'error'); }
      };
      return true;
    }
    const invite = d.kind === 'invite';
    box(main, `<form id="pwf"><div class="brand big"><span class="logo-mark">◆</span> ${esc(d.company)}</div>
      <h2>${invite ? 'Welcome, ' + esc(d.name) : 'Choose a new password'}</h2>
      <p class="muted">${invite ? 'Choose a password for your account. You will sign in with <b>' + esc(d.email) + '</b>.' : 'For the account <b>' + esc(d.email) + '</b>. You will be signed out on all other devices.'}</p>
      <label>Password <small class="muted">(at least 8 characters)</small><input name="password" type="password" minlength="8" required autocomplete="new-password"></label>
      <label>Repeat password<input name="again" type="password" minlength="8" required autocomplete="new-password"></label>
      <button class="btn primary block">${invite ? 'Create my account' : 'Save password'}</button></form>`);
    $('#pwf', main).onsubmit = async (e) => {
      e.preventDefault(); const f = e.target;
      if (f.password.value !== f.again.value) { toast('The two passwords are not the same', 'error'); return; }
      try { await api.post('/public/account/' + encodeURIComponent(token), { password: f.password.value }); await FB.loadMeta(); location.hash = '#/'; FB.render(); }
      catch (err) { toast(err.message, 'error'); }
    };
    return true;
  }, { public: true });

  /** Forgot your password? (from the sign-in page) */
  FB.forgotPassword = () => {
    const m = modal('Forgot your password?', `<form id="ff"><p class="muted">Enter your e-mail address. If it has an account, we send a link to choose a new password.</p>
      <label>E-mail<input name="email" type="email" required autocomplete="username"></label><div class="form-actions"><button class="btn primary">Send the link</button></div></form>`);
    $('#ff', m.root).onsubmit = async (e) => {
      e.preventDefault();
      try { await api.post('/forgot', { email: e.target.email.value }); m.close(); toast('If that address has an account, a link is on its way.', 'ok'); }
      catch (err) { toast(err.message, 'error'); }
    };
  };

  /** After inviting: say what happened, and when no mail can be sent yet, give the link to hand over. */
  FB.showInvite = (inv) => {
    if (!inv) return;
    if (inv.sent) { toast('Invitation sent to ' + inv.to, 'ok'); return; }
    const m = modal('Invitation for ' + inv.to, `<p class="muted">E-mail sending is not switched on yet, so nothing was sent. Give this personal link to the person (it works for 7 days, once):</p>
      <input readonly class="mono link-input" value="${esc(inv.link)}" id="invLink"><div class="form-actions"><button class="btn primary" id="cp">Copy link</button></div>`);
    $('#cp', m.root).onclick = async () => { $('#invLink', m.root).select(); try { await navigator.clipboard.writeText(inv.link); toast('Copied', 'ok'); } catch { /* selected: copy by hand */ } };
  };

  /** "Your account" card on the /me page. */
  FB.accountCard = (host, user) => {
    host.innerHTML = `<h2>Your account</h2><div class="card"><div class="two-col">
      <form id="pwForm"><h4>Change password</h4><label>Current password<input name="current" type="password" required autocomplete="current-password"></label>
        <label>New password <small class="muted">(at least 8 characters)</small><input name="password" type="password" minlength="8" required autocomplete="new-password"></label>
        <button class="btn">Change password</button></form>
      <form id="emForm"><h4>Change e-mail address</h4><p class="small muted">Now: ${esc(user.email)}. We send a confirmation link to the new address.</p>
        <label>New e-mail<input name="email" type="email" required></label><label>Current password<input name="password" type="password" required autocomplete="current-password"></label>
        <button class="btn">Send confirmation</button></form></div></div>`;
    $('#pwForm', host).onsubmit = async (e) => { e.preventDefault(); const f = e.target; try { await api.post('/me/password', { current: f.current.value, password: f.password.value }); f.reset(); toast('Password changed. Other devices are signed out.', 'ok'); } catch (err) { toast(err.message, 'error'); } };
    $('#emForm', host).onsubmit = async (e) => {
      e.preventDefault(); const f = e.target;
      try {
        const r = await api.post('/me/email', { email: f.email.value, password: f.password.value }); f.reset();
        if (r.sent) toast('Confirmation sent to ' + r.to, 'ok');
        else modal('Confirm the new address', `<p class="muted">E-mail sending is not switched on yet. Open this link yourself to confirm:</p><input readonly class="mono link-input" value="${esc(r.link)}">`);
      } catch (err) { toast(err.message, 'error'); }
    };
  };
})();
document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('[data-print]')) window.print(); });   // (no inline handlers anywhere: the page runs under a strict content security policy)
