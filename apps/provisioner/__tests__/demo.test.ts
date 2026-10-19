/**
 * The demo's fake card against the real provision(): every demo state must
 * end with the result kind the loop's state expects, so the words on screen
 * are tested against what the run actually returns, never against the chooser
 * that launched it.
 */
import {CASHU_PLAN, provision} from '../src/cardkit';
import {fakeCard} from '../src/demo/fakeCard';
import {runDemo, stopFor} from '../src/demo/runDemo';
import {DEMO_STATES} from '../src/strings';

const opts = {speed: 0, onEvent: () => undefined};

test('every demo state maps to its stop (or done)', () => {
  // the chooser's names stay in 1:1 step with what the run can produce
  expect(DEMO_STATES.map(d => d.id).sort()).toEqual(
    ['hasOld', 'hasValue', 'noSession', 'ok', 'oldVersion', 'pulled', 'wrongKeys'].sort(),
  );
});

test('a clean card is programmed end to end', async () => {
  const fake = fakeCard({installed: 'none'}, {speed: 0});
  const r = await provision(fake.tx, CASHU_PLAN, {
    replace: false,
    random: l => new Array(l).fill(0x5a),
    now: Date.now,
  });
  expect(r.ok).toBe(true);
  expect(fake.installedNow()).toBe('empty');
});

test('a lifted card stops the run as pulled', async () => {
  const run = await runDemo('pulled', {...opts});
  expect(run.result?.ok).toBe(false);
  expect(run.result?.kind).toBe('pulled');
  expect(stopFor(run)).toBe('pulled');
});

test('a card holding value is guarded, Replace or not', async () => {
  const run = await runDemo('hasValue', {...opts, replace: true});
  expect(run.result?.kind).toBe('guarded');
  expect(run.result?.reason).toContain('holds');
  expect(stopFor(run)).toBe('hasValue');
});

test('an empty install stops for Replace, then continues by it', async () => {
  const first = await runDemo('hasOld', {...opts});
  expect(first.result?.kind).toBe('guarded');
  expect(stopFor(first)).toBe('hasOld');
  const again = await runDemo('hasOld', {...opts, replace: true});
  expect(again.result?.ok).toBe(true);
});

test('old software upgrades through the same door', async () => {
  const first = await runDemo('oldVersion', {...opts});
  expect(first.result?.kind).toBe('guarded');
  expect(stopFor(first)).toBe('oldVersion');
  const again = await runDemo('oldVersion', {...opts, replace: true});
  expect(again.result?.ok).toBe(true);
});

test('wrong keys are caught before a byte of authentication is sent', async () => {
  const run = await runDemo('wrongKeys', {...opts});
  expect(run.result?.kind).toBe('wrongKeys');
  // cardkit proves the cryptogram offline and never sends EXTERNAL AUTHENTICATE
  expect(run.result?.apdus.some(a => a.ins === 0x82)).toBeFalsy();
  expect(stopFor(run)).toBe('wrongKeys');
});

test('the session-failure state sends nothing', async () => {
  const run = await runDemo('noSession', {...opts});
  expect(run.result).toBeNull();
  expect(run.sessionError).toBe('No card session: TagConnectionLost.');
  expect(stopFor(run)).toBe('noSession');
});
