import {ADMIN_ICONS} from './operator-admin-icons';

export const adminClient =
  `const ICONS = ${JSON.stringify(ADMIN_ICONS)};\n` +
  String.raw`
'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const icon = (name) =>
    '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    (ICONS[name] || ICONS.info) +
    '</svg>';
  const esc = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (c) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[c],
    );
  const initials = (name) =>
    String(name || '?')
      .split(/[._@ -]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0])
      .join('')
      .toUpperCase();
  const short = (value, n = 18) =>
    value && String(value).length > n
      ? String(value).slice(0, n - 5) + '…' + String(value).slice(-4)
      : String(value || 'Not bound');
  const date = (value, full = false) => {
    const d = new Date(Number(value) * 1000);
    return Number.isFinite(d.getTime())
      ? new Intl.DateTimeFormat(undefined, {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          ...(full ? { hour: 'numeric', minute: '2-digit' } : {}),
        }).format(d)
      : '—';
  };
  const ago = (value) => {
    const d = Math.floor(Date.now() / 1000 - Number(value));
    if (!Number.isFinite(d)) return '—';
    if (d < 0) return date(value);
    if (d < 60) return 'Just now';
    if (d < 3600) return Math.floor(d / 60) + 'm ago';
    if (d < 86400) return Math.floor(d / 3600) + 'h ago';
    if (d < 604800) return Math.floor(d / 86400) + 'd ago';
    return date(value);
  };
  let token = '',
    principal = null,
    currentName = '',
    view = 'operators',
    busy = false,
    toastTimer,
    updatedAt = null;
  let operators = [],
    attempts = [],
    events = [],
    attemptsError = '',
    activityError = '';
  const environment = location.hostname.includes('staging')
    ? 'Staging workspace'
    : /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
      ? 'Local workspace'
      : 'Production workspace';
  document
    .querySelectorAll('[data-environment]')
    .forEach((e) => (e.textContent = environment));
  const messages = {
    'operator-admin-required':
      'This account doesn’t have administrator access. Contact your deployment administrator.',
    'operator-admin-policy-invalid':
      'Administrator access is not configured correctly. Contact your deployment administrator.',
    'operator-exists':
      'That operator name is already in use. Choose a different name.',
    'bad-password': 'Use a password between 12 and 1,024 characters.',
    'bad-field': 'Check the form details and try again.',
    'cannot-disable-self':
      'You can’t disable your own account. Ask another administrator to manage your access.',
    'operator-not-found':
      'This operator no longer exists. Refresh the workspace.',
    'login-rate-limited':
      'Too many sign-in attempts. Wait a minute before trying again.',
    'no-session': 'Your session has expired. Sign in again to continue.',
    'bad-credentials': 'The operator name or password is incorrect.',
  };
  function notice(element, message, error = true) {
    element.hidden = !message;
    element.classList.toggle('error', error);
    element.textContent = message;
  }
  function toast(message, error = false) {
    clearTimeout(toastTimer);
    $('toast').className = 'toast' + (error ? ' error' : '');
    $('toast').innerHTML =
      icon(error ? 'alert' : 'check') + '<span>' + esc(message) + '</span>';
    $('toast').hidden = false;
    toastTimer = setTimeout(() => ($('toast').hidden = true), 6500);
  }
  function closeDialog() {
    if (busy) return;
    $('dialog').close();
    $('dialog').replaceChildren();
  }
  function locked(message = '', error = true) {
    token = '';
    principal = null;
    currentName = '';
    operators = [];
    attempts = [];
    events = [];
    updatedAt = null;
    $('admin').hidden = true;
    $('login-screen').hidden = false;
    if ($('dialog').open) $('dialog').close();
    $('dialog').replaceChildren();
    ['operators', 'attempts', 'audit'].forEach((id) => $(id).replaceChildren());
    document
      .querySelectorAll('.metric-value,.nav-count')
      .forEach((e) => (e.textContent = '—'));
    $('password').value = '';
    $('password').type = 'password';
    $('toast').hidden = true;
    const reveal = document.querySelector('[data-input="password"]');
    reveal.innerHTML = icon('eye');
    reveal.setAttribute('aria-label', 'Show password');
    reveal.setAttribute('aria-pressed', 'false');
    $('profile-name').textContent = '';
    $('profile-avatar').textContent = '—';
    $('operator-search').value = '';
    $('attempt-search').value = '';
    $('operator-filter').value = 'all';
    $('attempt-filter').value = 'all';
    document.title = 'Flash · Card operations';
    notice($('login-notice'), message, error);
  }
  async function revokeAndLock(message) {
    const previous = token;
    locked(message);
    if (previous)
      fetch('/auth/operator/signout', {
        method: 'POST',
        credentials: 'omit',
        headers: { Authorization: 'Bearer ' + previous },
      }).catch(() => {});
  }
  async function request(path, body, method) {
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 35000);
    try {
      const response = await fetch(path, {
        method: method || (body ? 'POST' : 'GET'),
        cache: 'no-store',
        credentials: 'omit',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      let value;
      try {
        value = await response.json();
      } catch {
        throw Error(
          'The service returned an unexpected response. Please try again.',
        );
      }
      if (!response.ok) {
        const reason = value.reason || value.error;
        const message =
          messages[reason] ||
          'The service couldn’t complete this request. Please refresh and try again.';
        if ((response.status === 401 || response.status === 403) && token)
          await revokeAndLock(message);
        throw Error(message);
      }
      return value;
    } catch (e) {
      if (e.name === 'AbortError')
        throw Error(
          'The service is taking too long. Your saved changes are not confirmed. Refresh before retrying.',
        );
      if (e instanceof TypeError)
        throw Error(
          'Couldn’t reach the service. Check your connection and try again.',
        );
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  function setBusy(value) {
    busy = value;
    document.body.setAttribute('aria-busy', String(value));
    document.querySelectorAll('button').forEach((b) => {
      if (value) {
        b.dataset.wasDisabled = b.disabled ? 'true' : 'false';
        b.disabled = true;
      } else {
        b.disabled = b.dataset.wasDisabled === 'true';
        delete b.dataset.wasDisabled;
      }
    });
    document
      .querySelectorAll('[data-action=refresh] svg')
      .forEach((e) => e.classList.toggle('spin', value));
  }
  async function perform(work) {
    if (busy) return;
    setBusy(true);
    try {
      await work();
    } catch (e) {
      if ($('dialog').open) notice($('dialog-error'), e.message);
      else if (!token) notice($('login-notice'), e.message);
      else toast(e.message, true);
    } finally {
      setBusy(false);
    }
  }
  const nameOf = (id) =>
    operators.find((o) => o.id === id)?.name || 'Operator #' + id;
  const badge = (state, label) =>
    '<span class="status-badge ' +
    esc(state) +
    '"><span class="dot"></span>' +
    esc(label || state[0].toUpperCase() + state.slice(1)) +
    '</span>';
  const empty = (symbol, title, description, reset) =>
    '<div class="empty"><span class="empty-symbol">' +
    icon(symbol) +
    '</span><h3>' +
    esc(title) +
    '</h3><p>' +
    esc(description) +
    '</p>' +
    (reset
      ? '<button class="btn btn-secondary" data-action="clear-filters">Clear filters</button>'
      : '') +
    '</div>';
  function renderOperators() {
    const query = $('operator-search').value.trim().toLowerCase(),
      filter = $('operator-filter').value;
    const rows = operators.filter(
      (o) =>
        (o.name.toLowerCase().includes(query) ||
          String(o.id).includes(query)) &&
        (filter === 'all' ||
          (filter === 'disabled' ? o.disabled : !o.disabled)),
    );
    $('operators').innerHTML = rows
      .map(
        (o) =>
          '<tr><td><div class="name-cell"><span class="avatar">' +
          esc(initials(o.name)) +
          '</span><div><div class="account-name">' +
          '<span class="name-label" title="' +
          esc(o.name) +
          '">' +
          esc(o.name) +
          '</span>' +
          (o.id === principal ? '<span class="you-tag">You</span>' : '') +
          '</div><div class="account-sub">Operator #' +
          esc(o.id) +
          '</div></div></div></td><td><span class="env-tag">' +
          icon(o.key_env === 'issued' ? 'shield' : 'key') +
          esc(o.key_env === 'issued' ? 'Issued' : 'Factory') +
          '</span></td><td>' +
          badge(
            o.disabled ? 'disabled' : 'active',
            o.disabled ? 'Disabled' : 'Active',
          ) +
          '</td><td class="column-joined muted">' +
          esc(date(o.created)) +
          '</td><td><div class="row-action"><button class="btn btn-ghost" data-action="operator" data-id="' +
          esc(o.id) +
          '" aria-label="Manage ' +
          esc(o.name) +
          '">Manage ' +
          icon('chevron') +
          '</button></div></td></tr>',
      )
      .join('');
    $('operators-count').textContent = operators.length;
    $('operators-showing').textContent =
      'Showing ' + rows.length + ' of ' + operators.length + ' operators';
    $('operators-empty').hidden = rows.length > 0;
    $('operators-empty').innerHTML = empty(
      'users',
      'No matching operators',
      'Try a different name or status to find the operator you’re looking for.',
      true,
    );
  }
  function renderAttempts() {
    const query = $('attempt-search').value.trim().toLowerCase(),
      filter = $('attempt-filter').value;
    const rows = attempts.filter(
      (a) =>
        [
          a.attempt_id,
          a.chip_id,
          a.batch_id,
          a.device_id,
          nameOf(a.operator_id),
        ]
          .join(' ')
          .toLowerCase()
          .includes(query) &&
        (filter === 'all' ||
          (filter === 'stopped'
            ? ['quarantined', 'abandoned'].includes(a.state)
            : a.state === filter)),
    );
    $('attempts').innerHTML = rows
      .map(
        (a) =>
          '<tr><td><div class="attempt-id">' +
          esc(short(a.attempt_id, 20)) +
          '</div><div class="account-sub">Batch ' +
          esc(a.batch_id) +
          ' · Card ' +
          esc(a.ordinal + 1) +
          '</div></td><td><span class="chip-text" title="' +
          esc(a.chip_id || 'No identity binding saved') +
          '">' +
          esc(short(a.chip_id, 24)) +
          '</span></td><td><span class="account-name">' +
          esc(nameOf(a.operator_id)) +
          '</span><div class="account-sub">' +
          esc(ago(a.created)) +
          '</div></td><td>' +
          badge(a.state) +
          '<div class="state-note">Revision ' +
          esc(a.revision) +
          '</div></td><td><button class="icon-btn" data-action="attempt" data-id="' +
          esc(a.attempt_id) +
          '" aria-label="View attempt ' +
          esc(a.attempt_id) +
          '">' +
          icon('arrowUp') +
          '</button></td></tr>',
      )
      .join('');
    $('attempts-count').textContent = attemptsError ? '—' : attempts.length;
    $('attempts-showing').textContent =
      'Showing ' + rows.length + ' of ' + attempts.length + ' recent attempts';
    notice($('attempts-error'), attemptsError);
    $('attempts-empty').hidden = rows.length > 0 || !!attemptsError;
    $('attempts-empty').innerHTML = attempts.length
      ? empty(
          'search',
          'No matching attempts',
          'Search by chip identity, batch, attempt, device or operator.',
          true,
        )
      : empty(
          'cards',
          'A clear start',
          'Provisioning attempts will appear here as operators create them. This view is read-only.',
        );
  }
  function renderActivity() {
    const labels = {
      create: 'created an operator',
      disable: 'disabled operator access',
      enable: 'restored operator access',
      'reset-password': 'reset a password',
    };
    const symbols = {
      create: 'plus',
      disable: 'lock',
      enable: 'shield',
      'reset-password': 'key',
    };
    $('audit').innerHTML = events
      .map(
        (e) =>
          '<article class="activity-row"><span class="activity-icon">' +
          icon(symbols[e.action] || 'clock') +
          '</span><div class="activity-copy"><strong>' +
          esc(nameOf(e.actor_id)) +
          '</strong> ' +
          esc(labels[e.action] || e.action) +
          '<p>' +
          esc(nameOf(e.target_id)) +
          ' · Operator #' +
          esc(e.target_id) +
          '</p></div><time class="activity-time" title="' +
          esc(date(e.created, true)) +
          '">' +
          esc(ago(e.created)) +
          '</time></article>',
      )
      .join('');
    $('activity-count').textContent = activityError ? '—' : events.length;
    $('activity-showing').textContent =
      events.length + ' recent administration events';
    notice($('activity-error'), activityError);
    $('activity-empty').hidden = events.length > 0 || !!activityError;
    $('activity-empty').innerHTML = empty(
      'clock',
      'Your activity starts here',
      'Operator creation, access changes and password resets will appear here automatically.',
    );
  }
  function render() {
    renderOperators();
    renderAttempts();
    renderActivity();
    $('metric-active').textContent = operators.filter(
      (o) => !o.disabled,
    ).length;
    $('metric-disabled').textContent = operators.filter(
      (o) => o.disabled,
    ).length;
    $('metric-attempts').textContent = attemptsError ? '—' : attempts.length;
    $('metric-stopped').textContent = attemptsError
      ? '—'
      : attempts.filter((a) => ['quarantined', 'abandoned'].includes(a.state))
          .length;
    $('nav-operators').textContent = operators.length;
    $('nav-attempts').textContent = attemptsError ? '—' : attempts.length;
    $('nav-activity').textContent = activityError ? '—' : events.length;
    const partial = !!(attemptsError || activityError);
    notice(
      $('workspace-notice'),
      partial
        ? 'Some workspace data couldn’t be refreshed. Available information is shown below; refresh to try again.'
        : '',
      false,
    );
    $('sync-status').innerHTML =
      '<span class="dot"></span>' +
      (partial
        ? 'Partial update'
        : updatedAt
          ? 'Updated ' +
            new Intl.DateTimeFormat(undefined, {
              hour: 'numeric',
              minute: '2-digit',
            }).format(updatedAt)
          : 'Connecting');
  }
  async function load() {
    const results = await Promise.allSettled([
      request('/admin/operators'),
      request('/admin/provisioning/attempts'),
      request('/admin/operators/audit'),
    ]);
    if (results[0].status === 'rejected') throw results[0].reason;
    if (!token) throw Error('Sign in again to view this workspace.');
    operators = results[0].value.operators;
    attemptsError =
      results[1].status === 'rejected'
        ? 'Installation evidence couldn’t be refreshed. Previously loaded rows may be out of date.'
        : '';
    activityError =
      results[2].status === 'rejected'
        ? 'Activity couldn’t be refreshed. Previously loaded events may be out of date.'
        : '';
    if (!attemptsError) attempts = results[1].value.attempts;
    if (!activityError) events = results[2].value.events;
    updatedAt = new Date();
    render();
  }
  function navigate(next, filter) {
    if (!['operators', 'attempts', 'activity'].includes(next)) return;
    view = next;
    document.querySelectorAll('.nav-btn').forEach((b) => {
      if (b.dataset.view === view) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    ['operators', 'attempts', 'activity'].forEach(
      (v) => ($('view-' + v).hidden = v !== view),
    );
    const titles = {
      operators: [
        'Operators',
        'Manage who can provision cards and keep access up to date.',
      ],
      attempts: [
        'Installations',
        'A clearer picture of every attempt. Without touching a card.',
      ],
      activity: [
        'Activity',
        'Every access change, with the people and context behind it.',
      ],
    };
    $('page-title').textContent = titles[view][0];
    $('breadcrumb').textContent = titles[view][0];
    $('page-description').textContent = titles[view][1];
    $('view-guidance').innerHTML =
      icon('info') +
      '<p>' +
      {
        operators:
          'Disable an operator to stop access while preserving their card history. Password resets revoke existing sessions.',
        attempts:
          'Quarantined and abandoned chip bindings remain blocked. Keep phone journals intact; this console cannot clear quarantine or perform a card reset.',
        activity:
          'This trail records successful administration changes. It does not include card commands, passwords or sign-in history.',
      }[view] +
      '</p>';
    if (filter) {
      if (view === 'operators') {
        $('operator-filter').value = filter;
        $('operator-search').value = '';
      }
      if (view === 'attempts') {
        $('attempt-filter').value = filter;
        $('attempt-search').value = '';
      }
    }
    renderOperators();
    renderAttempts();
    document.title = 'Flash · ' + titles[view][0];
  }
  function dialog(title, description, body, footer, form = false) {
    const d = $('dialog');
    d.innerHTML =
      (form ? '<form id="operator-form">' : '') +
      '<div class="dialog-head"><div><h2 id="dialog-title">' +
      esc(title) +
      '</h2><p>' +
      esc(description) +
      '</p></div><button type="button" class="icon-btn" data-action="close-dialog" aria-label="Close dialog">' +
      icon('close') +
      '</button></div><div class="dialog-body"><div id="dialog-error" class="notice error dialog-error" role="alert" hidden></div>' +
      body +
      '</div><div class="dialog-footer">' +
      footer +
      '</div>' +
      (form ? '</form>' : '');
    if (!d.open) d.showModal();
    requestAnimationFrame(() => {
      const focus = d.querySelector('[autofocus]');
      if (focus) focus.focus();
    });
  }
  const cancel =
    '<button type="button" class="btn btn-secondary" data-action="close-dialog">Cancel</button>';
  const passwordField =
    '<label class="field">New password<span class="password-wrap"><input id="new-password" name="new-password" type="password" autocomplete="new-password" minlength="12" maxlength="1024" required autofocus><button class="icon-btn" type="button" data-action="reveal" data-input="new-password" aria-label="Show password" aria-pressed="false">' +
    icon('eye') +
    '</button></span><span class="password-tools"><span>At least 12 characters</span><button class="text-btn" type="button" data-action="generate">Generate password</button></span></label><label class="check-field"><input type="checkbox" id="password-saved" required><span>I’ve saved this password in our organization’s vault. It won’t be shown again after saving.</span></label>';
  const copyValue = (value) =>
    '<div class="copy-value"><span class="mono">' +
    esc(value || 'Not bound') +
    '</span>' +
    (value
      ? '<button class="icon-btn" type="button" data-action="copy" data-value="' +
        esc(value) +
        '" aria-label="Copy value">' +
        icon('copy') +
        '</button>'
      : '') +
    '</div>';
  function openCreate() {
    dialog(
      'Add an operator',
      'Give a teammate their own provisioning account.',
      '<label class="field">Operator name<input id="new-name" name="username" autocomplete="off" placeholder="e.g. alex-provisioning" pattern="[A-Za-z0-9._@-]{1,64}" maxlength="64" required autofocus autocapitalize="none" spellcheck="false"><small>Letters, numbers, dots, underscores, @ and hyphens.</small></label>' +
        passwordField.replace(' required autofocus', ' required') +
        '<label class="field">Provisioning environment<select id="environment"><option value="issued">Issued — normal provisioning</option><option value="factory">Factory — authorized factory workflows</option></select><small>Use Issued for normal provisioning. This cannot be edited here later.</small></label>',
      cancel +
        '<button class="btn btn-primary" type="submit">' +
        icon('plus') +
        'Create operator</button>',
      true,
    );
    $('operator-form').onsubmit = (e) => {
      e.preventDefault();
      perform(async () => {
        const name = $('new-name').value,
          password = $('new-password').value,
          keyEnv = $('environment').value;
        $('new-password').value = '';
        await request('/admin/operators', { name, password, keyEnv });
        await saved(name + ' is ready to sign in.');
      });
    };
  }
  function openOperator(id) {
    const o = operators.find((o) => o.id === Number(id));
    if (!o) return;
    dialog(
      o.name,
      'Operator #' +
        o.id +
        (o.id === principal ? ' · Your administrator account' : ''),
      '<div class="dialog-emblem">' +
        icon('users') +
        '</div><dl class="detail-grid"><div><dt>Access</dt><dd>' +
        badge(
          o.disabled ? 'disabled' : 'active',
          o.disabled ? 'Disabled' : 'Active',
        ) +
        '</dd></div><div><dt>Environment</dt><dd>' +
        esc(o.key_env === 'issued' ? 'Issued' : 'Factory') +
        '</dd></div><div><dt>Created</dt><dd>' +
        esc(date(o.created)) +
        '</dd></div><div><dt>Role management</dt><dd>Deployment controlled</dd></div></dl><p class="help-caption">Passwords can’t be retrieved. Set a new password to restore sign-in access; all existing sessions will be revoked.</p><div class="drawer-actions"><button class="btn btn-secondary" data-action="reset" data-id="' +
        esc(o.id) +
        '">' +
        icon('key') +
        'Reset password</button><button class="btn ' +
        (o.disabled ? 'btn-primary' : 'btn-danger-soft') +
        '" data-action="access" data-id="' +
        esc(o.id) +
        '" ' +
        (o.id === principal ? 'disabled' : '') +
        '>' +
        icon(o.disabled ? 'shield' : 'lock') +
        (o.disabled ? 'Enable access' : 'Disable access') +
        '</button></div>' +
        (o.id === principal
          ? '<p class="help-caption">You can’t disable your own account.</p>'
          : ''),
      '<button class="btn btn-secondary" data-action="close-dialog" autofocus>Done</button>',
    );
  }
  function openReset(id) {
    const o = operators.find((o) => o.id === Number(id));
    if (!o) return;
    dialog(
      'Reset password',
      'Set a new password for ' + o.name + '.',
      '<div class="notice warning">' +
        icon('key') +
        '<p><strong>All existing sessions will be revoked.</strong>' +
        (o.disabled
          ? 'This account is disabled and will stay disabled.'
          : o.id === principal
            ? 'You’ll be signed out after saving. Sign back in with your new password.'
            : 'The operator will need to sign in with the new password.') +
        '</p></div>' +
        passwordField,
      cancel +
        '<button class="btn btn-primary" type="submit">Save new password</button>',
      true,
    );
    $('operator-form').onsubmit = (e) => {
      e.preventDefault();
      perform(async () => {
        const password = $('new-password').value;
        $('new-password').value = '';
        await request('/admin/operators/' + o.id + '/reset-password', {
          password,
        });
        if (o.id === principal) {
          locked('Password updated. Sign in with your new password.', false);
          return;
        }
        await saved('Password updated for ' + o.name + '.');
      });
    };
  }
  function openAccess(id) {
    const o = operators.find((o) => o.id === Number(id));
    if (!o || o.id === principal) return;
    const action = o.disabled ? 'enable' : 'disable';
    dialog(
      o.disabled ? 'Restore operator access?' : 'Disable operator access?',
      o.name + ' · Operator #' + o.id,
      '<div class="dialog-emblem ' +
        (o.disabled ? '' : 'danger') +
        '">' +
        icon(o.disabled ? 'shield' : 'lock') +
        '</div><p class="help-caption">' +
        (o.disabled
          ? 'This operator will be able to sign in using their current password. Previously revoked sessions will not be restored.'
          : 'This operator will be signed out and won’t be able to sign in again until you restore access. Their card and batch history will be preserved.') +
        '</p>',
      cancel +
        '<button type="submit" class="btn ' +
        (o.disabled ? 'btn-primary' : 'btn-danger') +
        '">' +
        (o.disabled ? 'Enable access' : 'Disable access') +
        '</button>',
      true,
    );
    $('operator-form').onsubmit = (e) => {
      e.preventDefault();
      perform(async () => {
        await request('/admin/operators/' + o.id + '/' + action, {});
        await saved(
          'Access ' +
            (o.disabled ? 'restored' : 'disabled') +
            ' for ' +
            o.name +
            '.',
        );
      });
    };
    $('dialog').querySelector('[data-action=close-dialog]').focus();
  }
  async function saved(message) {
    $('dialog').close();
    $('dialog').replaceChildren();
    try {
      await load();
      toast(message);
    } catch (e) {
      if (token) toast(message + ' Refresh to update the workspace.', true);
      else
        notice(
          $('login-notice'),
          message + ' Sign in again to continue.',
          false,
        );
    }
  }
  function openAttempt(id) {
    const a = attempts.find((a) => a.attempt_id === id);
    if (!a) return;
    const guidance = {
      quarantined:
        'Further provisioning of this chip is blocked. Keep the saved phone journal and reconcile the original failure before any card operation.',
      abandoned:
        'This stopped attempt remains part of the chip’s history and may block a new binding. Keep its evidence for reconciliation.',
      active:
        'An active reservation is saved. Continue only through the original phone’s supported workflow; this console cannot determine the physical installation stage.',
      recorded:
        'The service acknowledged this installation record. This does not certify holder setup, funds or payment readiness.',
    };
    dialog(
      'Installation details',
      'A read-only view of the saved service evidence.',
      '<div class="notice ' +
        (['quarantined', 'abandoned'].includes(a.state) ? 'warning' : '') +
        '">' +
        icon(a.state === 'quarantined' ? 'shield' : 'info') +
        '<p><strong>' +
        esc(a.state[0].toUpperCase() + a.state.slice(1)) +
        '</strong>' +
        esc(
          guidance[a.state] || 'Review the saved evidence before continuing.',
        ) +
        '</p></div><dl class="detail-grid"><div><dt>Batch / card</dt><dd>Batch ' +
        esc(a.batch_id) +
        ' · Card ' +
        esc(a.ordinal + 1) +
        '</dd></div><div><dt>Revision</dt><dd>' +
        esc(a.revision) +
        '</dd></div><div><dt>Operator</dt><dd>' +
        esc(nameOf(a.operator_id)) +
        '</dd></div><div><dt>Created</dt><dd>' +
        esc(date(a.created, true)) +
        '</dd></div><div class="detail-full"><dt>Attempt identity</dt><dd>' +
        copyValue(a.attempt_id) +
        '</dd></div><div class="detail-full"><dt>Chip identity</dt><dd>' +
        copyValue(a.chip_id) +
        '</dd></div><div class="detail-full"><dt>Device identity</dt><dd>' +
        copyValue(a.device_id) +
        '</dd></div></dl>',
      '<button class="btn btn-secondary" data-action="close-dialog" autofocus>Close details</button>',
    );
  }
  $('login').onsubmit = (e) => {
    e.preventDefault();
    perform(async () => {
      const name = $('name').value,
        password = $('password').value;
      $('password').value = '';
      notice($('login-notice'), '');
      $('login-submit').innerHTML =
        icon('refresh') + '<span>Signing in…</span>';
      try {
        const auth = await request('/auth/operator/session', {
          name,
          password,
        });
        token = auth.token;
        principal = auth.operator_id;
        currentName = name;
        await load();
        $('profile-name').textContent = currentName;
        $('profile-avatar').textContent = initials(currentName);
        $('login-screen').hidden = true;
        $('admin').hidden = false;
        navigate('operators');
        $('main').focus();
      } catch (e) {
        if (token) await revokeAndLock(e.message);
        throw e;
      } finally {
        $('login-submit').innerHTML =
          '<span>Sign in to workspace</span>' + icon('arrow');
      }
    });
  };
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.view) {
      navigate(b.dataset.view, b.dataset.filter);
      return;
    }
    const action = b.dataset.action,
      id = b.dataset.id;
    if (action === 'create') openCreate();
    else if (action === 'operator') openOperator(id);
    else if (action === 'reset') openReset(id);
    else if (action === 'access') openAccess(id);
    else if (action === 'attempt') openAttempt(id);
    else if (action === 'close-dialog') closeDialog();
    else if (action === 'refresh') perform(load);
    else if (action === 'logout')
      perform(async () => {
        try {
          await request('/auth/operator/signout', {});
        } finally {
          locked('You’ve signed out safely.', false);
          $('name').focus();
        }
      });
    else if (action === 'clear-filters') {
      if (view === 'operators') {
        $('operator-search').value = '';
        $('operator-filter').value = 'all';
        renderOperators();
      } else {
        $('attempt-search').value = '';
        $('attempt-filter').value = 'all';
        renderAttempts();
      }
    } else if (action === 'reveal') {
      const input = $(b.dataset.input),
        show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      b.innerHTML = icon(show ? 'eyeOff' : 'eye');
      b.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      b.setAttribute('aria-pressed', String(show));
    } else if (action === 'generate') {
      const bytes = crypto.getRandomValues(new Uint8Array(24)),
        alphabet =
          'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
      $('new-password').value = Array.from(
        bytes,
        (v) => alphabet[v % alphabet.length],
      ).join('');
      $('password-saved').checked = false;
      toast(
        'Password generated. Save it in your organization’s vault before continuing.',
      );
    } else if (action === 'copy') {
      if (navigator.clipboard)
        navigator.clipboard
          .writeText(b.dataset.value)
          .then(() => toast('Identity copied.'))
          .catch(() =>
            toast(
              'Couldn’t copy. Select the identity to copy it manually.',
              true,
            ),
          );
      else toast('Select the identity to copy it manually.', true);
    }
  });
  ['operator-search', 'attempt-search'].forEach((id) =>
    $(id).addEventListener('input', () =>
      id === 'operator-search' ? renderOperators() : renderAttempts(),
    ),
  );
  document.addEventListener('input', (e) => {
    if (e.target.id === 'new-password' && $('password-saved'))
      $('password-saved').checked = false;
  });
  $('operator-filter').onchange = renderOperators;
  $('attempt-filter').onchange = renderAttempts;
  $('dialog').addEventListener('cancel', (e) => {
    if (busy) e.preventDefault();
  });
  $('dialog').addEventListener('close', () => {
    if (!busy && !$('dialog').open) $('dialog').replaceChildren();
  });
  window.addEventListener('pagehide', () => {
    if (token)
      fetch('/auth/operator/signout', {
        method: 'POST',
        credentials: 'omit',
        keepalive: true,
        headers: { Authorization: 'Bearer ' + token },
      }).catch(() => {});
    token = '';
  });
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) locked('Sign in again to continue.');
  });
})();
`;
