/** The screen's words for each way a run can end. */
import {
  HOLD,
  describeResult,
  describeSessionError,
  labelFor,
} from '../src/copy';

const result = (extra: object) => ({
  ok: false,
  phase: 'load',
  timings: [],
  apdus: [],
  ...extra,
});

test('says to hold the card still', () => {
  expect(HOLD).toBe(
    'Hold the card against the back of the phone. Keep still until it finishes.',
  );
});

test('counts the LOAD blocks and names the phases', () => {
  expect(labelFor('cashu', {type: 'block', index: 37, of: 82})).toBe(
    'Loading 37 of 82',
  );
  expect(labelFor('cashu', {type: 'phase', phase: 'installCard'})).toBe(
    'Installing card',
  );
  expect(labelFor('hello', {type: 'phase', phase: 'installCard'})).toBe(
    'Installing the hello applet',
  );
  expect(
    labelFor('cashu', {
      type: 'apdu',
      record: {phase: 'load', ins: 0xe8, lc: 255, ms: 5},
    }),
  ).toBeNull();
});

test('tells the holder to tap again after the card moved', () => {
  expect(
    describeResult('cashu', result({kind: 'pulled'}), 'Loading 37 of 82'),
  ).toBe(
    'Card moved during Loading 37 of 82. Tap again; the partial install is removed first.',
  );
  expect(
    describeResult(
      'rotate',
      result({kind: 'pulled', phase: 'putKey'}),
      'Writing the new keys',
    ),
  ).toContain('finds which keys the card is on first');
});

test('says Cancelled, not Card moved, when the Cancel button ended the run', () => {
  expect(
    describeResult('cashu', result({kind: 'pulled'}), 'Installing card', true),
  ).toBe(
    'Cancelled during Installing card. Tap again; the partial install is removed first.',
  );
});

test('stops the app for wrong keys and a refused login, and not for a refused INSTALL', () => {
  expect(
    describeResult(
      'cashu',
      result({kind: 'wrongKeys', phase: 'auth'}),
      'Logging in',
    ),
  ).toContain('restart it');
  expect(
    describeResult(
      'cashu',
      result({kind: 'refused', ins: 0x82, sw: 0x6300, phase: 'auth'}),
      'Logging in',
    ),
  ).toBe(
    'The card refused EXTERNAL AUTHENTICATE with 6300 during Logging in. Nothing more was sent. The app is stopped: restart it before trying again.',
  );
  expect(
    describeResult(
      'cashu',
      result({kind: 'refused', ins: 0xe6, sw: 0x6f00, phase: 'installCard'}),
      'Installing card',
    ),
  ).toBe(
    'The card refused INSTALL with 6F00 during Installing card. Nothing more was sent.',
  );
});

test("passes on a guard's reason, and says what each success means", () => {
  expect(
    describeResult(
      'cashu',
      result({
        kind: 'guarded',
        reason: 'the card applet is installed and it has an owner',
      }),
      '',
    ),
  ).toBe(
    'Stopped before touching the card: the card applet is installed and it has an owner.',
  );
  expect(
    describeResult('hello', {...result({}), ok: true, phase: 'done'}, 'Done'),
  ).toContain('answered HELLO');
  expect(
    describeResult('cashu', {...result({}), ok: true, phase: 'done'}, 'Done'),
  ).toContain('02 01');
});

test('names a session that never reached the card', () => {
  class UserCancel extends Error {}
  class RadioDisabled extends Error {}
  expect(describeSessionError(new UserCancel())).toBe('Cancelled.');
  expect(describeSessionError(new RadioDisabled())).toBe(
    'NFC is off: turn it on in Settings.',
  );
  expect(describeSessionError(new Error('boom'))).toBe(
    'No card session: boom.',
  );
});
