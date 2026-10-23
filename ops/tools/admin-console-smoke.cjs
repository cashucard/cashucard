/** Optional browser acceptance check. Uses installed Chrome; never targets a remote service. */
const {spawn} = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');

async function main() {
  const chromeExecutable =
    process.env.CHROME_BIN ||
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  await fs.access(chromeExecutable);
  let fixture;
  let origin = process.env.ADMIN_CONSOLE_TEST_ORIGIN;
  if (!origin) {
    fixture = spawn(
      process.execPath,
      [
        '--import',
        require.resolve('tsx'),
        path.join(__dirname, 'admin-console-fixture.ts'),
      ],
      {stdio: ['ignore', 'pipe', 'pipe']},
    );
    origin = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        fixture.kill('SIGTERM');
        reject(Error('Local fixture did not start'));
      }, 15000);
      let text = '';
      fixture.stdout.on('data', chunk => {
        text += chunk;
        const match = /ADMIN_CONSOLE_ORIGIN=(http:\/\/127\.0\.0\.1:\d+)/.exec(
          text,
        );
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
      fixture.once('exit', () => {
        clearTimeout(timer);
        reject(Error('Local fixture exited before readiness'));
      });
    });
  }
  const url = new URL(origin);
  assert.ok(
    ['127.0.0.1', 'localhost'].includes(url.hostname) &&
      url.protocol === 'http:',
    'Synthetic local fixtures only',
  );
  const executable =
    process.env.CHROME_BIN ||
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const profile = await fs.mkdtemp(
    path.join(os.tmpdir(), 'cashu-admin-chrome-'),
  );
  const output =
    process.env.ADMIN_CONSOLE_SCREENSHOTS ||
    (await fs.mkdtemp(path.join(os.tmpdir(), 'cashu-admin-preview-')));
  await fs.mkdir(output, {recursive: true});
  const chrome = spawn(
    executable,
    [
      '--headless=new',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--remote-debugging-port=0',
      '--user-data-dir=' + profile,
      'about:blank',
    ],
    {stdio: 'ignore'},
  );
  chrome.on('error', () => {});
  let socket;
  try {
    let port;
    for (let i = 0; i < 100; i++) {
      try {
        port = (
          await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')
        ).split('\n')[0];
        break;
      } catch {
        await new Promise(r => setTimeout(r, 100));
      }
    }
    assert.ok(port, 'Chrome started');
    const target = await (
      await fetch(
        'http://127.0.0.1:' +
          port +
          '/json/new?' +
          encodeURIComponent(origin + '/ops/operators'),
        {method: 'PUT'},
      )
    ).json();
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = reject;
    });
    let seq = 0;
    const pending = new Map(),
      errors = [];
    socket.onmessage = e => {
      const msg = JSON.parse(e.data);
      if (msg.method === 'Runtime.exceptionThrown')
        errors.push(msg.params.exceptionDetails.text);
      if (msg.id && pending.has(msg.id)) {
        const {resolve, reject} = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? reject(Error(msg.error.message)) : resolve(msg.result);
      }
    };
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++seq;
        pending.set(id, {resolve, reject});
        socket.send(JSON.stringify({id, method, params}));
      });
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
      });
      if (result.exceptionDetails)
        throw Error(
          result.exceptionDetails.exception?.description ||
            result.exceptionDetails.text,
        );
      return result.result?.value;
    };
    const until = async (expression, label) => {
      for (let i = 0; i < 150; i++) {
        if (await evaluate(expression)) return;
        await new Promise(r => setTimeout(r, 100));
      }
      throw Error('Timed out: ' + label);
    };
    const click = selector =>
      evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const fill = (selector, value) =>
      evaluate(
        `(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
    const screenshot = async name => {
      await evaluate("document.querySelector('#toast').hidden=true");
      const {data} = await send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
      });
      await fs.writeFile(
        path.join(output, name + '.png'),
        Buffer.from(data, 'base64'),
      );
    };
    const viewport = (width, height) =>
      send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: width < 600,
      });
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Emulation.setEmulatedMedia', {
      features: [{name: 'prefers-reduced-motion', value: 'reduce'}],
    });
    await viewport(1440, 1000);
    await until(`!!document.querySelector('#login-screen')`, 'sign-in page');
    assert.equal(
      await evaluate(
        `document.querySelector('.skip-link').getAttribute('href')`,
      ),
      '#name',
      'Sign-in skip link targets a visible control',
    );
    await screenshot('01-sign-in-desktop');
    await viewport(390, 844);
    assert.equal(
      await evaluate('document.documentElement.scrollWidth<=innerWidth'),
      true,
      'Mobile sign-in has no horizontal overflow',
    );
    await screenshot('02-sign-in-mobile');
    await viewport(1440, 1000);
    const login = async (name, password) => {
      await fill('#name', name);
      await fill('#password', password);
      await evaluate(`document.querySelector('#login').requestSubmit()`);
    };
    await login('local-staff', 'published-test-password');
    await until(
      `document.querySelector('#login-notice').textContent.includes('administrator access')`,
      'ordinary operator denied',
    );
    assert.equal(
      await evaluate(`document.querySelector('#password').value`),
      '',
    );
    await login('local-admin', 'published-test-password');
    await until(
      `!document.querySelector('#admin').hidden && !document.body.getAttribute('aria-busy').includes('true')`,
      'administrator workspace',
    );
    assert.equal(
      await evaluate(`document.querySelectorAll('#operators tr').length`),
      3,
    );
    await screenshot('03-operators-desktop');
    await fill('#operator-search', 'no-matching-person');
    assert.equal(
      await evaluate(`document.querySelector('#operators-empty').hidden`),
      false,
    );
    await click('#operators-empty [data-action="clear-filters"]');
    await fill('#operator-search', 'local-staff');
    assert.equal(
      await evaluate(`document.querySelectorAll('#operators tr').length`),
      1,
    );
    await click('#operators [data-action="operator"]');
    await until(`document.querySelector('#dialog').open`, 'operator profile');
    await screenshot('04-operator-profile');
    await click('#dialog [data-action="close-dialog"]');
    await click('[data-action="create"]');
    await fill('#new-name', 'qa-operator');
    await click('[data-action="generate"]');
    assert.equal(
      await evaluate(`document.querySelector('#new-password').value.length`),
      24,
    );
    assert.equal(
      await evaluate(
        `document.querySelector('#operator-form').checkValidity()`,
      ),
      false,
      'Vault handoff acknowledgement required',
    );
    await screenshot('05-create-operator');
    await click('#password-saved');
    await evaluate(`document.querySelector('#operator-form').requestSubmit()`);
    await until(
      `!document.querySelector('#dialog').open && document.body.getAttribute('aria-busy')==='false'`,
      'create account',
    );
    await fill('#operator-search', 'local-staff');
    await click('#operators [data-action="operator"]');
    await click('#dialog [data-action="reset"]');
    await fill('#new-password', 'updated-test-password');
    await click('#password-saved');
    await evaluate(`document.querySelector('#operator-form').requestSubmit()`);
    await until(
      `!document.querySelector('#dialog').open && document.body.getAttribute('aria-busy')==='false'`,
      'reset password',
    );
    await click('#operators [data-action="operator"]');
    await click('#dialog [data-action="access"]');
    await screenshot('06-disable-confirmation');
    await evaluate(`document.querySelector('#operator-form').requestSubmit()`);
    await until(
      `!document.querySelector('#dialog').open && document.body.getAttribute('aria-busy')==='false'`,
      'disable operator',
    );
    assert.ok(
      await evaluate(
        `document.querySelector('#operators').textContent.includes('Disabled')`,
      ),
    );
    await click('#operators [data-action="operator"]');
    await click('#dialog [data-action="access"]');
    await evaluate(`document.querySelector('#operator-form').requestSubmit()`);
    await until(
      `!document.querySelector('#dialog').open && document.body.getAttribute('aria-busy')==='false'`,
      'restore operator access',
    );
    await click('.nav-btn[data-view="attempts"]');
    assert.equal(
      await evaluate(`document.querySelectorAll('#attempts tr').length`),
      2,
    );
    await fill('#attempt-search', '5547');
    assert.equal(
      await evaluate(`document.querySelectorAll('#attempts tr').length`),
      1,
    );
    await click('#attempts [data-action="attempt"]');
    assert.ok(
      await evaluate(
        `document.querySelector('#dialog').textContent.includes('Further provisioning of this chip is blocked')`,
      ),
    );
    await screenshot('07-installation-details');
    await send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
    });
    await send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
    });
    await until(
      `!document.querySelector('#dialog').open`,
      'Escape closes detail dialog',
    );
    await click('.nav-btn[data-view="activity"]');
    assert.ok(
      await evaluate(
        `document.querySelector('#audit').textContent.includes('reset a password')`,
      ),
    );
    await screenshot('08-activity-desktop');
    await send('Network.enable');
    await send('Network.setBlockedURLs', {
      urls: [origin + '/admin/operators/audit'],
    });
    await click('[data-action="refresh"]');
    await until(
      `document.body.getAttribute('aria-busy')==='false' && !document.querySelector('#workspace-notice').hidden`,
      'partial refresh is visible',
    );
    assert.equal(
      await evaluate(`document.querySelector('#activity-empty').hidden`),
      true,
      'An unavailable feed is not shown as empty',
    );
    await send('Network.setBlockedURLs', {urls: []});
    await click('[data-action="refresh"]');
    await until(
      `document.body.getAttribute('aria-busy')==='false' && document.querySelector('#workspace-notice').hidden`,
      'refresh recovers partial failure',
    );

    await viewport(390, 844);
    assert.equal(
      await evaluate('document.documentElement.scrollWidth<=innerWidth'),
      true,
      'Mobile workspace has no page overflow',
    );
    assert.equal(
      await evaluate(
        `getComputedStyle(document.querySelector('.mobile-menu')).display!=='none'`,
      ),
      true,
      'Mobile sign-out reachable',
    );
    await click('.nav-btn[data-view="operators"]');
    await fill('#operator-search', '');
    await screenshot('09-operators-mobile');
    await click('#operators [data-id="1"][data-action="operator"]');
    assert.equal(
      await evaluate(
        `document.querySelector('#dialog [data-action="access"]').disabled`,
      ),
      true,
      'Cannot disable self',
    );
    await click('#dialog [data-action="reset"]');
    await fill('#new-password', 'replacement-admin-password');
    await click('#password-saved');
    await evaluate(`document.querySelector('#operator-form').requestSubmit()`);
    await until(
      `!document.querySelector('#login-screen').hidden && document.body.getAttribute('aria-busy')==='false'`,
      'own password reset signs out',
    );
    await login('local-admin', 'replacement-admin-password');
    await until(
      `!document.querySelector('#admin').hidden && document.body.getAttribute('aria-busy')==='false'`,
      'new admin password works',
    );
    await click('.mobile-menu[data-action="logout"]');
    await until(`document.querySelector('#admin').hidden`, 'mobile sign-out');
    assert.equal(
      await evaluate(`document.querySelector('#operators').childElementCount`),
      0,
      'Sign-out clears operator data',
    );
    assert.equal(
      await evaluate('localStorage.length+sessionStorage.length'),
      0,
      'No browser storage credentials',
    );
    assert.deepEqual(errors, [], 'No uncaught browser errors');
    console.log(
      'PASS: real-browser sign-in, authorization, search, create, reset, disable/enable, details, keyboard, mobile and sign-out.',
    );
    console.log('Screenshots: ' + output);
  } finally {
    if (socket) socket.close();
    chrome.kill('SIGTERM');
    await new Promise(resolve => {
      if (chrome.exitCode !== null) resolve();
      else {
        chrome.once('exit', resolve);
        setTimeout(resolve, 3000);
      }
    });
    await fs.rm(profile, {recursive: true, force: true});
    if (fixture) fixture.kill('SIGTERM');
  }
}
main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
